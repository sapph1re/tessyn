// Platform-specific daemon auto-start installation (stretch goal)
// Placeholder for Phase 7 implementation

export function getInstallInstructions(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS: LaunchAgent plist in ~/Library/LaunchAgents/com.tessyn.daemon.plist';
    case 'linux':
      return 'Linux: systemd user service in ~/.config/systemd/user/tessyn.service';
    case 'win32':
      return 'Windows: Task Scheduler entry or Startup folder shortcut';
    default:
      return `Unsupported platform: ${process.platform}`;
  }
}
