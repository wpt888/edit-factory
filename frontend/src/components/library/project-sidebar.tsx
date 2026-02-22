"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Project } from "./types";

interface ProjectSidebarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onNewProject: () => void;
}

export function ProjectSidebar({
  projects,
  selectedProject,
  onSelectProject,
  onDeleteProject,
  onNewProject,
}: ProjectSidebarProps) {
  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-foreground flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Proiecte
          </CardTitle>
          <Button size="sm" onClick={onNewProject}>
            <Plus className="h-4 w-4 mr-1" />
            Nou
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto">
        {projects.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Niciun proiect"
            description="Creeaza primul proiect pentru a incepe."
            action={{ label: "Proiect Nou", onClick: onNewProject }}
          />
        ) : (
          projects.map((project) => (
            <div
              key={project.id}
              onClick={() => onSelectProject(project)}
              className={`p-3 rounded-lg cursor-pointer transition-all ${
                selectedProject?.id === project.id
                  ? "bg-primary/20 border border-primary"
                  : "bg-muted/50 hover:bg-accent border border-transparent"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-foreground font-medium truncate">
                  {project.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(project);
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs">
                  {project.variants_count} clipuri
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {project.selected_count} selectate
                </Badge>
              </div>
              <Badge
                className={`mt-2 text-xs ${
                  project.status === "ready_for_triage"
                    ? "bg-primary text-primary-foreground"
                    : project.status === "generating"
                    ? "bg-secondary text-secondary-foreground"
                    : "bg-muted"
                }`}
              >
                {project.status}
              </Badge>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
