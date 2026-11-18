"use client";

import { EditorContent, Node, mergeAttributes, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { GuideDocument } from "@guidesk/contracts";

/**
 * The text editor for guide items (feature 003 research R3), loaded on demand so the guide pages
 * keep their initial JavaScript under budget. Only the formatting of the content schema (R2) is
 * enabled: subheadings (levels 3 and 4), bold, italic, lists, links, hard breaks, and locked-field
 * references, which show the field's label and never a value. Pasted content is reduced to these
 * by the editor's schema; the API checks it again.
 */
export interface TextItemEditorProps {
  doc: GuideDocument | null;
  labelFor: (fieldId: string) => string;
  onChange: (doc: GuideDocument) => void;
  ariaLabel: string;
  /** Feature 003 US2: locked fields the toolbar can insert as references (FR-019). */
  lockedFields?: { id: string; label: string }[];
}

function lockedFieldNode(labelFor: (fieldId: string) => string) {
  return Node.create({
    name: "lockedField",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { fieldId: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: "span[data-locked-field]",
          getAttrs: (element) => ({ fieldId: element.getAttribute("data-locked-field") }),
        },
      ];
    },
    renderHTML({ node, HTMLAttributes }) {
      const fieldId = String(node.attrs.fieldId ?? "");
      return [
        "span",
        mergeAttributes(HTMLAttributes, {
          "data-locked-field": fieldId,
          class: "locked-field-chip",
          contenteditable: "false",
        }),
        `🔒 ${labelFor(fieldId)}`,
      ];
    },
  });
}

const EMPTY: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export default function TextItemEditor({
  doc,
  labelFor,
  onChange,
  ariaLabel,
  lockedFields = [],
}: TextItemEditorProps) {
  const t = useTranslations("guide.editor");
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        heading: { levels: [3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["mailto", "tel"],
        },
      }),
      lockedFieldNode(labelFor),
    ],
    content: doc && doc.content.length > 0 ? (doc as JSONContent) : EMPTY,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        role: "textbox",
        "aria-multiline": "true",
        class: "guide-editor-content",
      },
    },
    onUpdate: ({ editor: current }) => {
      const json = current.getJSON() as GuideDocument;
      // An editor holding one empty paragraph is an empty document.
      const empty =
        json.content.length === 1 &&
        json.content[0]?.type === "paragraph" &&
        !json.content[0].content?.length;
      changeRef.current(empty ? { type: "doc", content: [] } : json);
    },
  });

  if (!editor) return <div className="guide-editor-content" aria-busy="true" />;

  const button = (label: string, active: boolean, run: () => void) => (
    <button
      type="button"
      className={active ? "button button-secondary active" : "button button-secondary"}
      aria-pressed={active}
      onClick={run}
    >
      {label}
    </button>
  );

  return (
    <div className="guide-editor">
      <div className="guide-editor-toolbar" role="toolbar" aria-label={ariaLabel}>
        {button(t("bold"), editor.isActive("bold"), () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {button(t("italic"), editor.isActive("italic"), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {button(t("heading"), editor.isActive("heading", { level: 3 }), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
        )}
        {button(t("bulletList"), editor.isActive("bulletList"), () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {button(t("orderedList"), editor.isActive("orderedList"), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {button(t("link"), editor.isActive("link"), () => {
          const href = window.prompt(
            t("linkPrompt"),
            (editor.getAttributes("link").href as string | undefined) ?? "https://",
          );
          if (href === null) return;
          if (href.trim() === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
        })}
        {lockedFields.length > 0 && (
          <select
            aria-label={t("insertLocked")}
            value=""
            onChange={(event) => {
              const fieldId = event.target.value;
              if (!fieldId) return;
              editor
                .chain()
                .focus()
                .insertContent({ type: "lockedField", attrs: { fieldId } })
                .run();
            }}
          >
            <option value="">{t("insertLocked")}</option>
            {lockedFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
