import { useRef, useState } from "react";
import styles from "./ResizeHandle.module.scss";

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  ariaLabel: string;
  onResizeDelta: (delta: number) => void;
}

export function ResizeHandle({ orientation, ariaLabel, onResizeDelta }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const lastPosRef = useRef<number>(0);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPosRef.current = orientation === "vertical" ? event.clientX : event.clientY;
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const currentPos = orientation === "vertical" ? event.clientX : event.clientY;
    const delta = currentPos - lastPosRef.current;
    if (delta !== 0) {
      lastPosRef.current = currentPos;
      onResizeDelta(delta);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      tabIndex={0}
      data-dragging={dragging ? "true" : "false"}
      className={`${styles.handle} ${orientation === "vertical" ? styles.vertical : styles.horizontal}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={(event) => {
        if (orientation === "vertical") {
          if (event.key === "ArrowLeft") onResizeDelta(-16);
          if (event.key === "ArrowRight") onResizeDelta(16);
        } else {
          if (event.key === "ArrowUp") onResizeDelta(-16);
          if (event.key === "ArrowDown") onResizeDelta(16);
        }
      }}
    />
  );
}
