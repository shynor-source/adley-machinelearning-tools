export type FsAccessMode = "read" | "readwrite";

export interface DirectoryPickerOptions {
  id?: string;
  mode?: FsAccessMode;
  startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
}

export interface FileSystemPickerWindow extends Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}

declare global {
  interface FileSystemHandle {
    queryPermission?(descriptor?: { mode?: FsAccessMode }): Promise<PermissionState>;
    requestPermission?(descriptor?: { mode?: FsAccessMode }): Promise<PermissionState>;
  }
}

export {};
