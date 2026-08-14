import { FileArchive, FileImage, FileText } from "lucide-react";

const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);

type Props = {
  name: string;
  type: string;
  size?: number;
};

export function FileGlyph({ name, type, size = 22 }: Props) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (type.startsWith("image/")) return <FileImage size={size} />;
  if (extension && ARCHIVE_EXTENSIONS.has(extension)) return <FileArchive size={size} />;
  return <FileText size={size} />;
}
