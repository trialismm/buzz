import {
  ChevronRight,
  FolderInput,
  FolderMinus,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";

import type { ProjectFolder } from "@/features/sidebar/lib/projectFolders";
import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "@/features/sidebar/ui/sidebarMenuHelpers";
import { cn } from "@/shared/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

/**
 * Header row of one project folder inside the Projects section: a disclosure
 * button (name + project count) with Rename / Delete on its context menu.
 * See `lib/projectFolders.ts` for the model.
 */
export function ProjectFolderRow({
  collapsed,
  count,
  folder,
  onDelete,
  onRename,
  onToggle,
}: {
  collapsed: boolean;
  count: number;
  folder: ProjectFolder;
  onDelete: () => void;
  onRename: () => void;
  onToggle: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-expanded={!collapsed}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
            data-testid={`sidebar-project-folder-${folder.id}`}
            onClick={onToggle}
            tooltip={folder.name}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "transition-transform duration-150",
                !collapsed && "rotate-90",
              )}
            />
            <SidebarMenuLabel className="text-xs font-medium uppercase tracking-wide">
              {folder.icon ? `${folder.icon} ` : ""}
              {folder.name}
            </SidebarMenuLabel>
            <span className="ml-auto shrink-0 text-2xs tabular-nums text-sidebar-foreground/50">
              {count}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => deferMenuAction(onRename)}>
          <ContextMenuIconSlot>
            <Pencil className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>Rename folder</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => deferMenuAction(onDelete)}
        >
          <ContextMenuIconSlot>
            <Trash2 className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>Delete folder</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * "Move to folder" submenu for a project row's context menu: every folder,
 * a way out of the current one, and a shortcut to create a folder for this
 * project.
 */
export function ProjectFolderMoveMenu({
  currentFolderId,
  folders,
  onCreateFolder,
  onMove,
}: {
  currentFolderId: string | null;
  folders: readonly ProjectFolder[];
  onCreateFolder: () => void;
  onMove: (folderId: string | null) => void;
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ContextMenuIconSlot>
          <FolderInput className="h-4 w-4" />
        </ContextMenuIconSlot>
        <span>Move to folder</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {folders.map((folder) => (
          <ContextMenuItem
            disabled={folder.id === currentFolderId}
            key={folder.id}
            onSelect={() => deferMenuAction(() => onMove(folder.id))}
          >
            <span>
              {folder.icon ? `${folder.icon} ` : ""}
              {folder.name}
            </span>
          </ContextMenuItem>
        ))}
        {folders.length > 0 ? <ContextMenuSeparator /> : null}
        <ContextMenuItem onSelect={() => deferMenuAction(onCreateFolder)}>
          <ContextMenuIconSlot>
            <FolderPlus className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>New folder…</span>
        </ContextMenuItem>
        {currentFolderId ? (
          <ContextMenuItem onSelect={() => deferMenuAction(() => onMove(null))}>
            <ContextMenuIconSlot>
              <FolderMinus className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>Remove from folder</span>
          </ContextMenuItem>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
