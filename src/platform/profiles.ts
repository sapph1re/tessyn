import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../shared/logger.js';
import { getConfigDir, getClaudeDataDir } from './paths.js';

const log = createLogger('profiles');
const execFileAsync = promisify(execFile);

// === Types ===

export interface ProfileConfig {
  name: string;
  configDir: string; // may contain ~ for home dir
}

export interface ProfilesFile {
  profiles: ProfileConfig[];
  defaultProfile: string;
}

export interface ProfileInfo {
  name: string;
  configDir: string; // resolved absolute path
  isDefault: boolean;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  error?: string;
}

export interface ProfileWithAuth extends ProfileInfo {
  auth: AuthStatus;
}

// === Config File I/O ===

function getProfilesPath(): string {
  return path.join(getConfigDir(), 'profiles.json');
}

function resolveTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Load profiles from config file.
 * If the file doesn't exist, returns a single implicit "default" profile.
 */
export function loadProfiles(): ProfilesFile {
  const filePath = getProfilesPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as ProfilesFile;
    if (!Array.isArray(data.profiles) || data.profiles.length === 0) {
      return defaultProfilesFile();
    }
    return data;
  } catch {
    return defaultProfilesFile();
  }
}

/**
 * Save profiles to config file (atomic write).
 */
export function saveProfiles(profiles: ProfilesFile): void {
  const filePath = getProfilesPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(profiles, null, 2));
  fs.renameSync(tmpPath, filePath);
  log.info('Profiles saved', { count: profiles.profiles.length });
}

function defaultProfilesFile(): ProfilesFile {
  return {
    profiles: [{ name: 'default', configDir: getClaudeDataDir() }],
    defaultProfile: 'default',
  };
}

// === Profile Resolution ===

/**
 * Get all profiles with resolved absolute paths.
 */
export function getProfiles(): ProfileInfo[] {
  const data = loadProfiles();
  return data.profiles.map(p => ({
    name: p.name,
    configDir: resolveTilde(p.configDir),
    isDefault: p.name === data.defaultProfile,
  }));
}

/**
 * Resolve a profile name to its config directory path.
 * If name is omitted, returns the default profile's dir.
 * Returns null if the profile doesn't exist.
 */
export function resolveConfigDir(profileName?: string): string | null {
  const data = loadProfiles();
  const name = profileName ?? data.defaultProfile;
  const profile = data.profiles.find(p => p.name === name);
  return profile ? resolveTilde(profile.configDir) : null;
}

/**
 * Get the default profile name.
 */
export function getDefaultProfileName(): string {
  return loadProfiles().defaultProfile;
}

/**
 * Get the default profile's config directory.
 */
export function getDefaultProfileConfigDir(): string {
  const dir = resolveConfigDir();
  return dir ?? getClaudeDataDir();
}

// === Profile CRUD ===

/**
 * Add a new profile. Throws if name already exists.
 */
export function addProfile(name: string, configDir: string): void {
  if (!name.trim()) throw new Error('Profile name cannot be empty');
  const data = loadProfiles();
  if (data.profiles.some(p => p.name === name)) {
    throw new Error(`Profile "${name}" already exists`);
  }
  data.profiles.push({ name, configDir });
  saveProfiles(data);
}

/**
 * Remove a profile. Throws if it's the last one or doesn't exist.
 */
export function removeProfile(name: string): void {
  const data = loadProfiles();
  if (data.profiles.length <= 1) {
    throw new Error('Cannot remove the last profile');
  }
  const idx = data.profiles.findIndex(p => p.name === name);
  if (idx === -1) throw new Error(`Profile "${name}" not found`);
  data.profiles.splice(idx, 1);
  if (data.defaultProfile === name) {
    data.defaultProfile = data.profiles[0]!.name;
  }
  saveProfiles(data);
}

/**
 * Set the default profile. Throws if name doesn't exist.
 */
export function setDefaultProfile(name: string): void {
  const data = loadProfiles();
  if (!data.profiles.some(p => p.name === name)) {
    throw new Error(`Profile "${name}" not found`);
  }
  data.defaultProfile = name;
  saveProfiles(data);
}

// === Auth Status ===

/**
 * Check auth status for a specific config directory.
 * Spawns `claude auth status` with CLAUDE_CONFIG_DIR set.
 */
export async function checkAuthStatus(configDir: string): Promise<AuthStatus> {
  try {
    const { stdout } = await execFileAsync('claude', ['auth', 'status'], {
      timeout: 10000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    });

    const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return {
      loggedIn: data['loggedIn'] === true,
      authMethod: data['authMethod'] as string | undefined,
      email: data['email'] as string | undefined,
      orgName: data['orgName'] as string | undefined,
      subscriptionType: data['subscriptionType'] as string | undefined,
    };
  } catch (err) {
    // claude auth status exits with code 1 when not logged in but still outputs JSON
    if (err && typeof err === 'object' && 'stdout' in err) {
      const stdout = (err as { stdout: string }).stdout;
      try {
        const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
        return {
          loggedIn: data['loggedIn'] === true,
          authMethod: data['authMethod'] as string | undefined,
        };
      } catch {
        // Fall through to error case
      }
    }
    return {
      loggedIn: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check auth status for a profile by name.
 */
export async function checkProfileAuth(profileName?: string): Promise<ProfileWithAuth | null> {
  const configDir = resolveConfigDir(profileName);
  if (!configDir) return null;

  const data = loadProfiles();
  const name = profileName ?? data.defaultProfile;
  const auth = await checkAuthStatus(configDir);

  return {
    name,
    configDir,
    isDefault: name === data.defaultProfile,
    auth,
  };
}
