declare module 'xcode' {
  interface XcodeProject {
    parseSync(): void;
    writeSync(): string;
    addTarget(name: string, type: string, subfolder: string): { uuid: string } | null;
    addBuildPhase(files: string[], buildPhaseType: string, comment: string, target?: string): void;
    addSourceFile(path: string, opts?: Record<string, unknown>, group?: string): void;
    addResourceFile(path: string, opts?: Record<string, unknown>, group?: string): void;
    addPbxGroup(
      files: string[],
      name: string,
      path: string,
    ): { uuid: string; pbxGroup: Record<string, unknown> };
    pbxNativeTargetSection(): Record<string, unknown>;
    pbxXCBuildConfigurationSection(): Record<string, unknown>;
    findPBXGroupKey(criteria: Record<string, string>): string | null;
  }

  function project(path: string): XcodeProject;
  export = { project };
}
