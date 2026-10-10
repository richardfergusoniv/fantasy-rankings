import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function shortcutModLabel(): string {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)) {
    return "⌘";
  }
  return "Ctrl";
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mod = shortcutModLabel();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="shortcuts-dialog" aria-describedby="shortcuts-description">
        <DialogCloseButton label="Close keyboard shortcuts" />
        <DialogHeader className="shortcuts-dialog-header pr-8">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="shortcuts-description">
            Available when you are not typing in a field.
          </DialogDescription>
        </DialogHeader>
        <dl className="shortcuts-list">
          <div>
            <dt><kbd>{mod}</kbd> + <kbd>K</kbd></dt>
            <dd>Open command bar</dd>
          </div>
          <div>
            <dt><kbd>?</kbd></dt>
            <dd>Show this shortcuts list</dd>
          </div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}
