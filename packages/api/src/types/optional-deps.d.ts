// Type stubs for optional cloud provider dependencies
// These are only required at runtime when the corresponding storage provider is configured

declare module '@aws-sdk/client-s3' {
  export class S3Client {
    constructor(config: any);
    send(command: any): Promise<any>;
    destroy(): void;
  }
  export class PutObjectCommand {
    constructor(input: any);
  }
  export class GetObjectCommand {
    constructor(input: any);
  }
  export class DeleteObjectCommand {
    constructor(input: any);
  }
  export class DeleteObjectsCommand {
    constructor(input: any);
  }
  export class HeadObjectCommand {
    constructor(input: any);
  }
  export class ListObjectsV2Command {
    constructor(input: any);
  }
  export class CopyObjectCommand {
    constructor(input: any);
  }
  export class CreateMultipartUploadCommand {
    constructor(input: any);
  }
  export class UploadPartCommand {
    constructor(input: any);
  }
  export class CompleteMultipartUploadCommand {
    constructor(input: any);
  }
  export class CreateBucketCommand {
    constructor(input: any);
  }
  export class HeadBucketCommand {
    constructor(input: any);
  }
  export class ListBucketsCommand {
    constructor(input?: any);
  }
}

declare module '@google-cloud/storage' {
  export class Storage {
    constructor(config?: any);
    bucket(name: string): any;
  }
}
