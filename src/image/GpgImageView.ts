import { FileView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { _log } from  "src/common/utils";
import GpgImage from "./GpgImage";

// Display gpg encrypted image
export default class GpgImageView extends FileView {
  public static readonly VIEW_TYPE = "Gpg-Image-View";

  imgFile:TFile | null = null;
  filePath: string | null = null;
  currentObjectUrl: string | null = null;

  constructor(leaf: WorkspaceLeaf, private decoder: (file: TFile) => Promise<ArrayBuffer>) {
    super(leaf);
  }

  getViewType(): string {
    return GpgImageView.VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'GpgImage View';
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.imgFile = file;
    this.filePath = file.path;

    console.log("Opening file: " + this.imgFile.path);
    await this.renderImage();
  }

  clearObjectUrl() {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  async onClose(): Promise<void> {
    // cleanup if necessary
    this.clearObjectUrl();
  }

  async renderImage(): Promise<void> {
    const container = this.containerEl;
    container.empty();

    if (this.imgFile == null) {
      container.createEl('div', { text: 'No file provided to image view.' });
      return;
    }

    const buf = await this.decoder(this.imgFile);
    const blob = new Blob([buf], { type: await GpgImage.makeMimeType(buf) });

    this.clearObjectUrl();
    this.currentObjectUrl = URL.createObjectURL(blob);

    const header = container.createEl("div", { cls: "gpgimage-header" });
    const title = header.createEl("div", { cls: "gpgimage-title-container" });
    if (this.filePath) {
      title.setText(this.filePath);
    }
    const lockContainer = header.createEl("div", { cls: "gpgimage-lock" });
    setIcon(lockContainer, "lock");

    const imgEl = container.createEl('img', { cls: "gpgimage" });
    imgEl.style.maxWidth = '100%';
    imgEl.style.maxHeight = '100%';
    imgEl.src = this.currentObjectUrl;
    imgEl.alt = this.imgFile.path;

  }
}