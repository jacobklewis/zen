import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Crepe } from "@milkdown/crepe";

export interface CrepeEditorHandle {
  getMarkdown: () => string;
}

interface CrepeEditorProps {
  defaultValue: string;
  onChange?: (markdown: string) => void;
}

export const CrepeEditor = forwardRef<CrepeEditorHandle, CrepeEditorProps>(
  function CrepeEditor({ defaultValue, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => crepeRef.current?.getMarkdown() ?? "",
      }),
      [],
    );

    useEffect(() => {
      if (!containerRef.current) return;

      const crepe = new Crepe({
        root: containerRef.current,
        defaultValue,
      });

      // Suppress the very first markdownUpdated event fired on mount so
      // loading a file doesn't immediately mark the document dirty.
      let initialized = false;
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          if (!initialized) {
            initialized = true;
            return;
          }
          onChangeRef.current?.(markdown);
        });
      });

      crepeRef.current = crepe;
      void crepe.create();

      return () => {
        crepeRef.current = null;
        void crepe.destroy();
      };
      // Re-create the editor whenever defaultValue changes (e.g. opening a
      // different file). Crepe is not designed for live re-hydration.
    }, [defaultValue]);

    return <div ref={containerRef} className="crepe-host" />;
  },
);
