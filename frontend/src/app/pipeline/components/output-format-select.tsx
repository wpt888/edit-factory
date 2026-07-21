"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PIPELINE_FORMATS = [
  { label: "Vertical 9:16", width: 1080, height: 1920 },
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Landscape 16:9", width: 1920, height: 1080 },
  { label: "Portrait 4:5", width: 1080, height: 1350 },
  { label: "Portrait 3:4", width: 1080, height: 1440 },
  { label: "Landscape 4:3", width: 1440, height: 1080 },
  { label: "Cinematic 21:9", width: 2520, height: 1080 },
] as const;

type OutputFormatSelectProps = {
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
};

/** Output video format for the render. Lived inside the attention picker until
 *  the picker moved to Step 3; the format is still chosen upfront in Step 1. */
export function OutputFormatSelect({ width, height, onChange }: OutputFormatSelectProps) {
  const match = PIPELINE_FORMATS.find((format) => format.width === width && format.height === height);
  return (
    <div className="space-y-1.5">
      <Label htmlFor="pipeline-output-format" className="text-xs font-medium text-muted-foreground">
        Output video format
      </Label>
      <Select
        value={match ? `${match.width}x${match.height}` : "custom"}
        onValueChange={(value) => {
          const format = PIPELINE_FORMATS.find((item) => `${item.width}x${item.height}` === value);
          if (format) onChange(format.width, format.height);
        }}
      >
        <SelectTrigger id="pipeline-output-format" size="sm" className="w-full text-xs" data-testid="pipeline-output-format">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PIPELINE_FORMATS.map((format) => (
            <SelectItem key={`${format.width}x${format.height}`} value={`${format.width}x${format.height}`}>
              {format.label} · {format.width}x{format.height}
            </SelectItem>
          ))}
          {!match && <SelectItem value="custom">Custom · {width}x{height}</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  );
}
