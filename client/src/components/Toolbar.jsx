import { useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  FileUp,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from 'lucide-react';
import { api } from '../api.js';
import { ACCEPTED_LABEL, ACCEPTED_TYPES } from '../lib.js';
import { useToast } from './ui.jsx';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function ToolButton({ icon: Icon, label, shortcut, active, disabled, onClick }) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      className={`tool-btn${active ? ' is-active' : ''}`}
      title={title}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // Keep the editor's selection while clicking toolbar buttons.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={18} strokeWidth={2.1} />
    </button>
  );
}

const Divider = () => <span className="tool-divider" aria-hidden="true" />;

const BLOCK_STYLES = [
  { level: 0, label: 'Normal text' },
  { level: 1, label: 'Heading 1' },
  { level: 2, label: 'Heading 2' },
  { level: 3, label: 'Heading 3' },
];

/**
 * Paragraph/heading picker. A custom menu rather than a native <select> so the
 * editor never loses focus or selection while a style is chosen.
 */
function BlockStyleMenu({ heading, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = heading ? `Heading ${heading}` : 'Normal text';
  const keepFocus = (e) => e.preventDefault();

  return (
    <div className="block-menu" ref={ref}>
      <button
        type="button"
        className="block-select"
        aria-label={`Text style: ${current}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu block-menu-list" role="listbox" aria-label="Text style">
          {BLOCK_STYLES.map((o) => (
            <button
              key={o.level}
              type="button"
              role="option"
              aria-selected={heading === o.level}
              className={`menu-item block-option block-option-${o.level}${heading === o.level ? ' is-active' : ''}`}
              onMouseDown={keepFocus}
              onClick={() => {
                onSelect(o.level);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ editor }) {
  const toast = useToast();
  const fileInput = useRef(null);
  const [importing, setImporting] = useState(false);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      heading: [1, 2, 3, 4, 5, 6].find((level) => e.isActive('heading', { level })) ?? 0,
      align: ['center', 'right'].find((a) => e.isActive({ textAlign: a })) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const run = (fn) => () => fn(editor.chain().focus()).run();

  function setBlock(level) {
    const chain = editor.chain().focus();
    if (level === 0) chain.setParagraph().run();
    else chain.setHeading({ level }).run();
  }

  async function insertFromFile(file) {
    if (!file) return;
    setImporting(true);
    try {
      const { html } = await api.convertFile(file);
      editor.chain().focus().insertContent(html).run();
      toast(`Inserted content from “${file.name}”`, 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton icon={Undo2} label="Undo" shortcut={`${MOD}Z`} disabled={!s.canUndo} onClick={run((c) => c.undo())} />
      <ToolButton icon={Redo2} label="Redo" shortcut={`${MOD}Shift+Z`} disabled={!s.canRedo} onClick={run((c) => c.redo())} />
      <Divider />
      <BlockStyleMenu heading={s.heading} onSelect={setBlock} />
      <Divider />
      <ToolButton icon={Bold} label="Bold" shortcut={`${MOD}B`} active={s.bold} onClick={run((c) => c.toggleBold())} />
      <ToolButton icon={Italic} label="Italic" shortcut={`${MOD}I`} active={s.italic} onClick={run((c) => c.toggleItalic())} />
      <ToolButton icon={Underline} label="Underline" shortcut={`${MOD}U`} active={s.underline} onClick={run((c) => c.toggleUnderline())} />
      <ToolButton icon={Strikethrough} label="Strikethrough" shortcut={`${MOD}Shift+S`} active={s.strike} onClick={run((c) => c.toggleStrike())} />
      <Divider />
      <ToolButton icon={List} label="Bulleted list" shortcut={`${MOD}Shift+8`} active={s.bullet} onClick={run((c) => c.toggleBulletList())} />
      <ToolButton icon={ListOrdered} label="Numbered list" shortcut={`${MOD}Shift+7`} active={s.ordered} onClick={run((c) => c.toggleOrderedList())} />
      <ToolButton icon={Quote} label="Quote" active={s.quote} onClick={run((c) => c.toggleBlockquote())} />
      <ToolButton icon={Minus} label="Horizontal line" onClick={run((c) => c.setHorizontalRule())} />
      <Divider />
      <ToolButton icon={AlignLeft} label="Align left" active={s.align === 'left'} onClick={run((c) => c.setTextAlign('left'))} />
      <ToolButton icon={AlignCenter} label="Align center" active={s.align === 'center'} onClick={run((c) => c.setTextAlign('center'))} />
      <ToolButton icon={AlignRight} label="Align right" active={s.align === 'right'} onClick={run((c) => c.setTextAlign('right'))} />
      <Divider />
      <ToolButton icon={RemoveFormatting} label="Clear formatting" onClick={run((c) => c.unsetAllMarks().clearNodes())} />
      <span className="toolbar-spacer" />
      <button
        type="button"
        className="tool-btn tool-btn-text"
        title={`Insert the contents of a ${ACCEPTED_LABEL} file at the cursor`}
        disabled={importing}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fileInput.current?.click()}
      >
        <FileUp size={17} /> {importing ? 'Importing…' : 'Insert file'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_TYPES}
        hidden
        onChange={(e) => {
          insertFromFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
