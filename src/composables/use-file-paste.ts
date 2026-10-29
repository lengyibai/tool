import { onActivated, onDeactivated, onMounted, onUnmounted } from "vue";

export const isAudioFile = (file: File) =>
  file.type.startsWith("audio/") || /\.(aac|aif|aiff|flac|m4a|mp3|oga|ogg|opus|wav|wave|wma)$/i.test(file.name);

export const useFilePaste = (
  acceptsFile: (file: File) => boolean,
  canPaste: () => boolean,
  importFiles: (files: File[]) => void,
) => {
  let listening = false;

  const handlePaste = (event: ClipboardEvent) => {
    if (!canPaste()) return;

    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.kind !== "file") continue;

      const file = item.getAsFile();
      if (file && acceptsFile(file)) files.push(file);
    }

    if (!files.length) return;
    event.preventDefault();
    importFiles(files);
  };

  const addListener = () => {
    if (listening) return;
    window.addEventListener("paste", handlePaste);
    listening = true;
  };

  const removeListener = () => {
    if (!listening) return;
    window.removeEventListener("paste", handlePaste);
    listening = false;
  };

  onMounted(addListener);
  onActivated(addListener);
  onDeactivated(removeListener);
  onUnmounted(removeListener);
};
