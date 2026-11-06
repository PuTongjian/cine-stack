declare module '@movie/crawler-engine' {
  export class SuenenClient { constructor(config: any); ensureSession(): Promise<void>; search(title: string): Promise<any[]>; }
  export class QuarkClient { constructor(config: any); cookie: string; downloadUrl(fileId: string): Promise<string>; listFiles(folderId?: string): Promise<any[]>; ensureFolder(parentId: string, name: string): Promise<{ id: string; name: string; created: boolean }>; inspectShare(shareId: string, passcode?: string, folderId?: string): Promise<any>; transfer(input: any): Promise<string>; waitTask(taskId: string): Promise<any>; rename(fileId: string, name: string): Promise<void>; uploadSmallFile(folderId: string, name: string, content: string | Buffer, contentType?: string): Promise<any>; }
}
