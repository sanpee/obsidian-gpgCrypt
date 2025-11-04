import * as openpgp from "openpgp";
import GpgImage from "src/image/GpgImage";

type BinaryInput = Uint8Array | ArrayBuffer | ArrayBufferView | Blob;

export class BackendNative {

  private publicKey: openpgp.PublicKey | null = null;
  private privateKey: openpgp.PrivateKey | null = null;
  private privateKeyArmored: string | null = null;

  hasPublicKey(): boolean {
    return (this.publicKey != null);
  }

  hasPrivateKey(): boolean {
    return (this.privateKey != null);
  }

  isPrivateKeyEncrypted() {
    return this.privateKey && !this.privateKey.isDecrypted();
  }

  setPassphrase() {
    return this.privateKey && this.privateKey.isDecrypted;
  }

  async setKeys(publicKey: string | null, privateKey: string | null) {
    if (publicKey) {
      this.publicKey = await openpgp.readKey({ armoredKey: publicKey });
    } else {
      this.publicKey = null;
    }

    if (privateKey) {
      this.privateKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
      this.privateKeyArmored = privateKey;
    } else {
      this.privateKey = null;
      this.privateKeyArmored = null;
    }

  }

  async encrypt(plaintext: string): Promise<string>;
  async encrypt(data: Uint8Array | ArrayBuffer | Blob): Promise<ArrayBuffer>;

  // Single implementation
  async encrypt(input: string | BinaryInput): Promise<string | ArrayBuffer> {
    if (!this.publicKey) {
      throw new Error("No public key for encryption configured!");
    }

    // handle string case (return armored string)
    if (typeof input === "string") {
      const message = await openpgp.createMessage({ text: input });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys: this.publicKey,
        format: "armored", // returns string
      });
      return encrypted as string;
    }

    // handle binary case (return Uint8Array)
    const bin = await this.toUint8Array(input);
    const message = await openpgp.createMessage({ binary: bin });
    const encrypted = await openpgp.encrypt({
      message,
      encryptionKeys: this.publicKey,
      format: "binary", // returns Uint8Array
    });

    const buf = encrypted.buffer;
    if (buf instanceof ArrayBuffer && encrypted.byteOffset === 0 && encrypted.byteLength === buf.byteLength) {
      const hdr = GpgImage.Header
      const buf2 = new Uint8Array(hdr.byteLength + buf.byteLength);
      buf2.set(hdr, 0);
      buf2.set(new Uint8Array(buf), hdr.byteLength);
      return buf2.buffer;
    }

    return new Uint8Array(encrypted).buffer;
  }

  // helper to normalize many binary forms to Uint8Array
  async toUint8Array(input: BinaryInput): Promise<Uint8Array> {
    if (input instanceof Uint8Array) return input;
    if (typeof (globalThis as any).Buffer !== "undefined" && (globalThis as any).Buffer.isBuffer?.(input)) {
      return new Uint8Array((input as any).buffer, (input as any).byteOffset || 0, (input as any).byteLength || (input as any).buffer.byteLength);
    }
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      const view = input as ArrayBufferView;
      return new Uint8Array(view.buffer, (view as any).byteOffset || 0, view.byteLength);
    }
    if (input instanceof Blob) {
      const ab = await input.arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error("Unsupported binary input type");
  }

  async decrypt(plaintext: string, passphrase: string | null): Promise<string>;
  async decrypt(data: Uint8Array | ArrayBuffer | Blob, passphrase: string | null): Promise<ArrayBuffer>;

  async decrypt(input: string | BinaryInput, passphrase: string | null): Promise<string | ArrayBuffer> {
    if (!this.privateKey || !this.privateKeyArmored) {
      throw new Error("No private key for decryption configured!");
    }

    let privateKey = this.privateKey;

    if (this.isPrivateKeyEncrypted()) {
      if (passphrase !== null) {
        privateKey = await openpgp.decryptKey({
          privateKey: await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored }),
          passphrase
        });
      } else {
        throw new Error("No passphrase for private key provided!");
      }
    }

    if (typeof input === "string") {
      const message = await openpgp.readMessage({
        armoredMessage: input
      });

      const { data: decrypted } = await openpgp.decrypt({
        message,
        decryptionKeys: privateKey
      });

      return decrypted as string;
    }

    // Binary decryption starts here
    let bin = await this.toUint8Array(input);
    if (Buffer.compare(bin.slice(0, GpgImage.Header.length), GpgImage.Header) === 0) {
      // Strip the header
      bin = bin.slice(GpgImage.Header.length);
    }

    const message = await openpgp.readMessage({ binaryMessage: bin });
    const { data: decrypted } = await openpgp.decrypt({
      message,
      decryptionKeys: privateKey,
      format: "binary", // returns Uint8Array
    });

    const buf = decrypted.buffer;
    if (buf instanceof ArrayBuffer && decrypted.byteOffset === 0 && decrypted.byteLength === buf.byteLength) {
      return buf;
    }

    return new Uint8Array(decrypted).buffer;
  }

  async testPassphrase(passphrase: string | null) {
    if (!this.privateKey || !this.privateKeyArmored) {
      throw new Error("No private key for decryption configured!");
    }

    if (!this.isPrivateKeyEncrypted()) {
      throw new Error("Private key is not encrypted.");
    }

    if (passphrase === null) {
      throw new Error("No passphrase for private key provided!");
    }

    await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: this.privateKeyArmored }),
      passphrase
    });
  }

  async isEncrypted(content: string | null): Promise<boolean> {
    if (content == null) {
      return false;
    }

    try {
      // Attempt to read the buffer as a PGP message
      const message = await openpgp.readMessage({ armoredMessage: content });
      if (message) return true;
    } catch (err) {
      // If an error occurs, it's likely not a valid PGP encrypted file
    }

    return false;
  }

  async generateKeypair(name: string, email: string, passphrase: string): Promise<{ publicKey: string, privateKey: string }> {
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: 'rsa',
      userIDs: [{ name: name, email: email }],
      passphrase: passphrase,
      format: "armored"
    });

    return { publicKey, privateKey };
  }
}