declare module '@react-native-firebase/messaging' {
  interface RemoteMessage {
    notification?: {
      title?: string;
      body?: string;
    };
    data?: Record<string, string>;
    messageId?: string;
  }

  interface Messaging {
    onMessage(listener: (message: RemoteMessage) => Promise<void> | void): () => void;
  }

  export default function messaging(): Messaging;
}
