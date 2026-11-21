import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ArchitectureFlowNode } from "../utils/graphTransform";
import styles from "./ArchitectureNode.module.scss";

export function ArchitectureNode({ data }: NodeProps<ArchitectureFlowNode>) {
  const className = [
    styles.node,
    data.isSelected ? styles.nodeSelected : "",
    !data.isSelected && data.isConnected ? styles.nodeConnected : "",
    data.isDimmed ? styles.nodeDimmed : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} title={data.filePath}>
      <Handle type="target" position={Position.Left} />
      <div className={styles.headerRow}>
        <span className={styles.fileName}>{data.fileName}</span>
        <span className={styles.langBadge}>{data.language}</span>
      </div>
      <div className={styles.folder}>{data.folder}</div>
      <div className={styles.metrics}>
        <span>In: {data.incomingCount}</span>
        <span>Out: {data.outgoingCount}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
