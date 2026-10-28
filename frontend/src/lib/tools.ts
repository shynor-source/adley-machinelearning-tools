import {
  Layers,
  ScanSearch,
  Table2,
  Tags,
  TextSearch,
  type LucideIcon,
} from "lucide-react";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  available: boolean;
  estimated?: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    id: "classification",
    name: "Image Classification",
    description:
      "Sort local images into classes with collision-safe copies, checkpoints, and resume support.",
    icon: Tags,
    available: true,
  },
  {
    id: "object-detection",
    name: "Object Detection",
    description: "Draw bounding boxes and export detection annotations. In development.",
    icon: ScanSearch,
    available: false,
    estimated: "Planned",
  },
  {
    id: "segmentation",
    name: "Image Segmentation",
    description: "Create masks and polygon annotations for pixel-level training data.",
    icon: Layers,
    available: false,
    estimated: "Planned",
  },
  {
    id: "tabular",
    name: "Tabular ML",
    description: "Profile CSV datasets, clean columns, and prepare tabular train/test splits.",
    icon: Table2,
    available: false,
    estimated: "Planned",
  },
  {
    id: "text",
    name: "Text Classification",
    description: "Label text records and organize local documents into training categories.",
    icon: TextSearch,
    available: false,
    estimated: "Planned",
  },
];

export function findTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
