"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

/** Moves one ID to a new place in a list; out-of-range places clamp to the ends (feature 022). */
export function moveItem(ids: readonly string[], id: string, to: number): string[] {
  if (!ids.includes(id)) return [...ids];
  const rest = ids.filter((candidate) => candidate !== id);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id);
  return rest;
}

/**
 * Lays the sortable items out in a new order, in the slots sortable items had: the others (such
 * as shared content) keep their places.
 */
export function inOrder<T extends { id: string }>(
  items: readonly T[],
  sortable: (item: T) => boolean,
  order: readonly string[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const queue = order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
  let next = 0;
  return items.map((item) => (sortable(item) ? (queue[next++] ?? item) : item));
}

/** What a drag handle needs from `useSortable`, spread on its button. */
export type SortableHandleProps = ReturnType<ReturnType<typeof useSortable>["handleProps"]>;

export interface SortableMessages {
  movedTo: (position: number, total: number) => string;
  cancelled: string;
}

/**
 * Ordering by dragging a handle with a mouse or a finger, or with the keyboard on the focused
 * handle (arrows, Home, End; Escape cancels a drag), with the new place announced (feature 022
 * FR-007, WCAG 2.5.7). One `onMove` per drop or key press; the preview holds until it settles.
 */
export function useSortable({
  ids,
  disabled,
  onMove,
  messages,
}: {
  ids: readonly string[];
  disabled: boolean;
  onMove: (order: string[]) => Promise<unknown>;
  messages: SortableMessages;
}) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ id: string; origin: string[]; order: string[] } | null>(null);
  const order = preview ?? [...ids];

  // A moved handle keeps the focus once the list shows the new order.
  useEffect(() => {
    if (!focusId) return;
    handles.current.get(focusId)?.focus();
  }, [focusId, order]);

  const commit = useCallback(
    (next: string[], id: string) => {
      setPreview(next);
      setAnnouncement(messages.movedTo(next.indexOf(id) + 1, next.length));
      void onMove(next)
        .catch(() => undefined)
        .finally(() => {
          setPreview(null);
          setFocusId(null);
        });
    },
    [messages, onMove],
  );

  const cancel = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDraggingId(null);
    setPreview(null);
    setAnnouncement(messages.cancelled);
  }, [messages]);

  // The pointer is followed on the window: moving the dragged item in the page would end a
  // pointer capture on its handle, and the drop would be lost.
  const stopListening = useRef<(() => void) | null>(null);
  useEffect(() => () => stopListening.current?.(), []);

  const startDrag = (id: string) => {
    stopListening.current?.();
    drag.current = { id, origin: [...order], order: [...order] };
    setDraggingId(id);
    setPreview([...order]);
    const move = (event: globalThis.PointerEvent) => {
      const current = drag.current;
      if (!current) return;
      const y = event.clientY;
      // The new place: how many other items have their middle above the pointer.
      const above = current.order.filter((other) => {
        if (other === current.id) return false;
        const box = items.current.get(other)?.getBoundingClientRect();
        return box ? y > box.top + box.height / 2 : false;
      }).length;
      const next = moveItem(current.order, current.id, above);
      if (next.join() !== current.order.join()) {
        current.order = next;
        setPreview(next);
      }
      if (y < 80) window.scrollBy(0, -12);
      else if (y > window.innerHeight - 120) window.scrollBy(0, 12);
    };
    const drop = () => {
      stopListening.current?.();
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      setDraggingId(null);
      if (current.order.join() === current.origin.join()) {
        setPreview(null);
        return;
      }
      commit(current.order, current.id);
    };
    const abort = () => {
      stopListening.current?.();
      cancel();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") abort();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", escape);
    stopListening.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", escape);
      stopListening.current = null;
    };
  };

  const itemRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) items.current.set(id, element);
      else items.current.delete(id);
    },
    [],
  );

  const handleProps = (id: string) => ({
    ref: (element: HTMLButtonElement | null) => {
      if (element) handles.current.set(id, element);
      else handles.current.delete(id);
    },
    disabled,
    "aria-pressed": draggingId === id,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      startDrag(id);
    },
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled || drag.current) return;
      // Quick presses build on the order shown, even before the last one is saved.
      const index = order.indexOf(id);
      const target =
        event.key === "ArrowUp"
          ? index - 1
          : event.key === "ArrowDown"
            ? index + 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? order.length - 1
                : null;
      if (target === null) return;
      event.preventDefault();
      if (target < 0 || target >= order.length || target === index) return;
      setFocusId(id);
      commit(moveItem(order, id, target), id);
    },
  });

  return { order, draggingId, announcement, itemRef, handleProps };
}
