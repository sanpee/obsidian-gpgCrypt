import {fileTypeFromBuffer} from "file-type";
import { buffer } from "node:stream/consumers";

const NATIVEIMAGEFORMATEXTENSIONS = ["png", "jpg", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"];
const HEADER = new TextEncoder().encode("%GPG%");

// Gather all util functions used by GpgImage
export default class GpgImage {

  constructor() {
  }

  public static get NativeImageExtension() : string[] {
    return NATIVEIMAGEFORMATEXTENSIONS;
  }

  public static get GpgImageExtension() : string[] {
    // return NATIVEIMAGEFORMATEXTENSIONS.map( x => x + "x").concat("gpgimg");
    return ["gpgimg"];
  }

  public static get Header(): Uint8Array {
    return HEADER;
  }

  // Simple check for header
  public static isEncrypted(data: ArrayBuffer) : boolean {
    if (data.byteLength > GpgImage.Header.length) {
      return Buffer.compare(new Uint8Array(data.slice(0, GpgImage.Header.length)), GpgImage.Header) === 0;
    }

    return false;
  }

  public static hasNativeImageExtension(path: string): boolean {
    const low = path.toLowerCase();
    return GpgImage.NativeImageExtension.some((ext) => low.endsWith(ext));
  }

  public static hasSupportedExtension(path: string): boolean {
    const makeExtRegex = (ext: string) => {
      const esc = ext.replace(/[.*+?^{}()|[\]\\]/g, '\\&');
      return new RegExp('\.' + esc + '(?=(?:[?#]|$))', 'i');
    };

    const low = path.toLowerCase();
    return GpgImage.GpgImageExtension.some((ext) => low.endsWith(ext) || makeExtRegex(ext).test(low));
  }

  public static changeFileExt(path: string): string {
    return path + "." + GpgImage.GpgImageExtension[0];
  }

  public static removeFileExt(path: string): string {
    return path.replace("." + GpgImage.GpgImageExtension[0], "");
  }

  public static async makeMimeType(data: ArrayBuffer): Promise<string> {
    try {
      const fileType = await fileTypeFromBuffer(data);
      if (fileType == null) {
        throw new Error("Uknown file type!");
      }
      return fileType.mime;
    } catch (error) {
      throw error;
    }
  }
}