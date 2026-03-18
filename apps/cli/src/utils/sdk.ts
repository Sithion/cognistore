import { KnowledgeSDK } from '@ai-knowledge/sdk';

let sdkInstance: KnowledgeSDK | null = null;

export async function getSDK(): Promise<KnowledgeSDK> {
  if (!sdkInstance) {
    sdkInstance = new KnowledgeSDK();
    await sdkInstance.initialize();
  }
  return sdkInstance;
}

export async function closeSDK(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.close();
    sdkInstance = null;
  }
}
