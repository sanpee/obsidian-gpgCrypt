import { Plugin, MarkdownPostProcessorContext, TFile, Component, MarkdownRenderChild, normalizePath } from 'obsidian';
import GpgImage from './GpgImage';
import { _log } from 'src/common/utils';

// Small Component used to run cleanup when the markdown block is removed / view unloaded
class ImageCleanupComponent extends MarkdownRenderChild {
  constructor(
    container: HTMLElement,
    private img: HTMLImageElement,
    private url: string,
    private urlSet: Set<string>
  ) {
    super(container); // pass the container element to MarkdownRenderChild
  }

  onunload() {
    if (this.url) {
      try { URL.revokeObjectURL(this.url); } catch { }
      this.urlSet.delete(this.url);
    }
  }
}

// Class-based markdown post-processor for GpgImage
export default class GpgImagePostProcessor {
  private objectUrls = new Set<string>();

  constructor(private plugin: Plugin, private decoder: (file: TFile) => Promise<any>) {
  }

  public async process(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('*'));
    for (const node of nodes) {
      const { path, size } = this.extractPathFromNode(node);
      if (!path) continue;

      if (!GpgImage.hasSupportedExtension(path)) continue;

      // Prevent double-processing
      if ((node as any)._specialImageProcessed) continue;
      (node as any)._specialImageProcessed = true;

      const placeholder = document.createElement('div');
      placeholder.className = 'gpgimage-placeholder';
      placeholder.style.minHeight = '48px';
      placeholder.style.display = 'flex';
      placeholder.style.alignItems = 'center';
      placeholder.style.justifyContent = 'center';

      const img = document.createElement('img');
      img.alt = path;
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.display = 'block';

      img.onload = () => _log('Loaded', path, img.naturalWidth, img.naturalHeight);
      img.onerror = (e) => _log('Failed to load', path, e, img.src);

      placeholder.appendChild(img);
      node.replaceWith(placeholder);

      // Kick off decode async (no need to await for the whole processor)
      this.loadAndSetImage(path, img, placeholder, ctx, size).catch((err) => {
        _log('decode/render error for', path, err);
        // show fallback text
        placeholder.textContent = 'Failed to decode ' + path;
      });
    }
  }

  private resolveFileFromLink(linkPath: string | null | undefined, sourcePath?: string): TFile | null {
    if (!linkPath) return null;

    let p = null;
    if (/^app:/.test(linkPath)) {
      const u = new URL(linkPath);
      p = decodeURIComponent(u.pathname).trim();
      const adapter: any = (this.plugin.app.vault.adapter as any);
      const basePath: string | null = adapter?.basePath ?? (typeof adapter?.getBasePath === 'function' ? adapter.getBasePath() : null);
      if (basePath) {
        // normalize from URL
        p = p.replace(basePath.replace(/\\/g, '/'), '');
      }
    }
    else {
      p = decodeURIComponent(linkPath).trim();
    }

    if (!p) return null;
    p = p.replace(/^\/+/, ''); // remove leading slashes if any

    if (sourcePath) {
      const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(p, sourcePath);
      if (dest instanceof TFile) return dest;
    }

    const af = this.plugin.app.vault.getAbstractFileByPath(p);
    if (af instanceof TFile) return af;

    const files = this.plugin.app.vault.getFiles();
    const exact = files.find(f => f.path === p);
    if (exact) return exact;
    const suffix = files.find(f => f.path.endsWith('/' + p) || f.path === p);
    if (suffix) return suffix;

    return null;
  }

  private async loadAndSetImage(
    path: string,
    img: HTMLImageElement,
    placeholder: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    size: { width?: string; height?: string }
  ) {
    const af = this.resolveFileFromLink(path, ctx.sourcePath);
    if (!af || !(af instanceof TFile)) {
      throw new Error("Not a vault file: " + path);
    }

    // _log(`image resize to ${size.width ?? "auto"} x ${size.height ?? "auto"}`)

    // Apply CSS sizing to placeholder & img so percentage widths have a reference
    placeholder.style.display = "block";
    placeholder.style.width = '100%'; // container fills available width
    // default behavior if no explicit size: constrain width to container
    if (!size.width && !size.height) {
      img.style.maxWidth = "100%";
      img.style.height = "auto";
    } else {
      // If explicit width provided, set it. If it's percent, CSS will size relative to placeholder.
      if (size.width) {
        img.style.width = size.width + "px";
        // allow the image to scale but not exceed container unless explicit px desired
        if (!size.width.endsWith("%")) img.style.maxWidth = 'none';
        else img.style.maxWidth = '100%';
      } else {
        img.style.width = "auto";
      }

      if (size.height) {
        img.style.height = size.height + "px";
      } else if (size.width) {
        // if only width specified, ensure height auto to preserve aspect ratio
        img.style.height = "auto";
      }
    }

    const decoded = await this.decoder(af);
    const mimeType = await GpgImage.makeMimeType(decoded);
    _log(`${af.path} is a ${mimeType}`);

    let blob: Blob;
    if (decoded instanceof Blob) {
      blob = decoded;
    } else if (decoded instanceof ArrayBuffer || ArrayBuffer.isView(decoded)) {
      const ab = decoded instanceof ArrayBuffer ? decoded : (decoded as any).buffer instanceof ArrayBuffer ? (decoded as any).buffer : decoded;
      blob = new Blob([ab], { type: mimeType });
    } else {
      throw new Error('Decoder returned unsupported type: ' + typeof decoded);
    }

    // revoke previous url on this img if present
    const prev = (img as any)._specialObjectUrl as string | undefined;
    if (prev) {
      try { URL.revokeObjectURL(prev); } catch { }
      this.objectUrls.delete(prev);
    }

    const objectUrl = URL.createObjectURL(blob);
    (img as any)._specialObjectUrl = objectUrl;
    this.objectUrls.add(objectUrl);
    img.src = objectUrl;

    // Register cleanup
    const cleanup = new ImageCleanupComponent(placeholder, img, objectUrl, this.objectUrls);
    ctx.addChild(cleanup);
  }

  private extractPathFromNode(node: HTMLElement): { path: string | null; size: { width?: string; height?: string } } {
    const dp = node.getAttribute('data-path');
    if (dp) return { path: dp, size: { width: undefined, height: undefined } };

    let imgPath = null;

    const href = node.getAttribute?.('href') ?? null;
    if (href && !/^[a-zA-Z]+:\/\//.test(href)) imgPath = href;

    // src may be URI or may be just filename, will let resolveFileFromLink() to process
    const src = node.getAttribute?.('src') ?? null;
    if (src) imgPath = decodeURI(src);

    const text = node.textContent?.trim() ?? '';
    if (text && GpgImage.hasSupportedExtension(text)) imgPath = text;

    const w = node.getAttribute?.('width');
    const h = node.getAttribute?.('height');

    return { path: imgPath, size: { width: w ?? undefined, height: h ?? undefined } };
  }

  // Optionally call when the plugin unloads to revoke remaining URLs:
  public revokeAll() {
    for (const url of this.objectUrls) {
      try { URL.revokeObjectURL(url); } catch { }
    }
    this.objectUrls.clear();
  }
}