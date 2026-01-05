"use client";

import { useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { formatElapsedTime } from "@/hooks/use-job-polling";

interface ProgressTrackerProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Current status ("pending", "processing", "completed", "failed") */
  status: string;
  /** Status text to display */
  statusText?: string;
  /** Elapsed time in seconds */
  elapsedTime?: number;
  /** Estimated time remaining string */
  estimatedRemaining?: string;
  /** Called when cancel button is clicked */
  onCancel?: () => void;
  /** Show cancel button */
  showCancel?: boolean;
  /** Custom class name */
  className?: string;
}

export function ProgressTracker({
  progress,
  status,
  statusText,
  elapsedTime = 0,
  estimatedRemaining,
  onCancel,
  showCancel = true,
  className = "",
}: ProgressTrackerProps) {
  const statusConfig = useMemo(() => {
    switch (status) {
      case "pending":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          variant: "secondary" as const,
          label: "In asteptare",
          color: "text-yellow-600",
        };
      case "processing":
        return {
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          variant: "default" as const,
          label: "Procesare",
          color: "text-blue-600",
        };
      case "completed":
        return {
          icon: <CheckCircle2 className="h-4 w-4" />,
          variant: "default" as const,
          label: "Finalizat",
          color: "text-green-600",
        };
      case "failed":
        return {
          icon: <AlertCircle className="h-4 w-4" />,
          variant: "destructive" as const,
          label: "Esuat",
          color: "text-red-600",
        };
      default:
        return {
          icon: <Loader2 className="h-4 w-4" />,
          variant: "secondary" as const,
          label: status,
          color: "text-muted-foreground",
        };
    }
  }, [status]);

  const isActive = status === "pending" || status === "processing";

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header with status and time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={statusConfig.variant} className="gap-1">
            {statusConfig.icon}
            {statusConfig.label}
          </Badge>
          {statusText && (
            <span className="text-sm text-muted-foreground">{statusText}</span>
          )}
        </div>

        {showCancel && isActive && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 px-2"
          >
            <X className="h-4 w-4 mr-1" />
            Anuleaza
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <Progress value={progress} className="h-2" />

      {/* Progress info */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="font-medium">{Math.round(progress)}%</span>

          {elapsedTime > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatElapsedTime(elapsedTime)}</span>
            </div>
          )}
        </div>

        {isActive && estimatedRemaining && (
          <span className="text-xs">
            Timp ramas: {estimatedRemaining}
          </span>
        )}
      </div>
    </div>
  );
}
