import { useLocation } from "@tanstack/react-router";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Folder,
  FolderPlus,
  Folders,
  Hash,
  Link2,
  ListMinus,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  type Project,
  useDeleteProjectMutation,
  useProjectsQuery,
} from "@/features/projects/hooks";
import { listProjectChildChannels } from "@/features/projects/lib/projectRelatedChannels";
import { canDeleteProject } from "@/features/projects/projectDeletion";
import { useProjectOwnerProfiles } from "@/features/projects/useProjectOwnerProfiles";
import { projectShareLink } from "@/features/projects/lib/projectShareLinks";
import {
  addProjectToSidebar,
  removeProjectFromSidebar,
} from "@/features/projects/lib/projectSidebarMembership";
import { useProjectSidebarMembership } from "@/features/projects/lib/useProjectSidebarMembership";
import { projectMatchesRouteId } from "@/features/projects/projectRoutes";
import { ProjectBrowserDialog } from "@/features/projects/ui/ProjectBrowserDialog";
import { ProjectChannelIcon } from "@/features/projects/ui/ProjectChannelIcon";
import { useCreateProjectMutation } from "@/features/projects/useCreateProject";
import { useIdentityQuery } from "@/shared/api/hooks";
import { FeatureGate } from "@/shared/features";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/cn";
import { getCachedRelayOrigin } from "@/shared/lib/mediaUrl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "@/features/sidebar/ui/sidebarMenuHelpers";
import {
  SECTION_ACTION_VISIBILITY_CLASS,
  SECTION_ICON_BUTTON_CLASS,
} from "@/features/sidebar/ui/sidebarSectionStyles";
import {
  addProjectFolder,
  assignProjectToFolder,
  groupProjectsByFolder,
  type ProjectFolder,
  type ProjectFolderStore,
  readProjectFolderStore,
  removeProjectFolder,
  renameProjectFolder,
  reorderProjectFolders,
  setProjectFolderCollapsed,
  writeProjectFolderStore,
} from "@/features/sidebar/lib/projectFolders";
import { SectionNameDialog } from "@/features/sidebar/ui/ChannelSectionDialogs";
import {
  DraggableChannelRow,
  DroppableSectionBody,
  DroppableUngroupedBody,
  SidebarDndContext,
  SortableSectionShell,
} from "@/features/sidebar/ui/SidebarDnd";
import {
  ProjectFolderMoveMenu,
  ProjectFolderRow,
} from "@/features/sidebar/ui/SidebarProjectFolders";
import {
  listSidebarProjects,
  readSidebarProjectExpansion,
  readSidebarProjectsFilter,
  readSidebarProjectsSort,
  selectedChannelRouteId,
  selectedProjectRouteId,
  type SidebarProjectExpansionState,
  type SidebarProjectsFilter,
  type SidebarProjectsSort,
  writeSidebarProjectExpansion,
  writeSidebarProjectsFilter,
  writeSidebarProjectsSort,
} from "@/features/sidebar/ui/listSidebarProjects";

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100 group-data-[section-actions-open=true]/sidebar-section:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS =
  "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

/**
 * Collapsible list of the viewer's projects in the left sidebar. Rendered
 * only when the Projects experiment is enabled, and only includes projects
 * the viewer owns or contributes to (optionally owned-only).
 */
export function SidebarProjectsSection() {
  return (
    <FeatureGate feature="projects">
      <SidebarProjectsSectionContent />
    </FeatureGate>
  );
}

function SidebarProjectsSectionContent() {
  const projectsQuery = useProjectsQuery();
  const channelsQuery = useChannelsQuery();
  const identityQuery = useIdentityQuery();
  const ownerProfiles = useProjectOwnerProfiles(projectsQuery.data ?? []);
  const currentPubkey = identityQuery.data?.pubkey;
  const { goChannel, goProject, goProjects } = useAppNavigation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeProjectId = selectedProjectRouteId(pathname);
  const routeChannelId = selectedChannelRouteId(pathname);
  const relayOrigin = getCachedRelayOrigin();
  const [collapsed, setCollapsed] = React.useState(false);
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [projectToDelete, setProjectToDelete] = React.useState<Project | null>(
    null,
  );
  const [filter, setFilter] = React.useState<SidebarProjectsFilter>(() =>
    readSidebarProjectsFilter(relayOrigin, currentPubkey),
  );
  const [sort, setSort] = React.useState<SidebarProjectsSort>(() =>
    readSidebarProjectsSort(relayOrigin, currentPubkey),
  );
  const [projectExpansion, setProjectExpansion] =
    React.useState<SidebarProjectExpansionState>(() =>
      readSidebarProjectExpansion(relayOrigin, currentPubkey),
    );
  const [folderStore, setFolderStore] = React.useState<ProjectFolderStore>(() =>
    readProjectFolderStore(relayOrigin, currentPubkey),
  );
  // `create` optionally files a project into the folder it just made.
  const [folderDialog, setFolderDialog] = React.useState<
    | { mode: "create"; projectAddress: string | null }
    | { mode: "rename"; folder: ProjectFolder }
    | null
  >(null);
  const addedProjectAddresses = useProjectSidebarMembership(
    relayOrigin,
    currentPubkey,
  );
  const createProjectMutation = useCreateProjectMutation();
  const deleteProjectMutation = useDeleteProjectMutation();
  const isPending = projectsQuery.isPending || identityQuery.isPending;
  React.useEffect(() => {
    setProjectExpansion(
      readSidebarProjectExpansion(relayOrigin, currentPubkey),
    );
    // Filter/sort are scoped like expansion: re-read on identity/community
    // change (currentPubkey is undefined until the identity query resolves).
    setFilter(readSidebarProjectsFilter(relayOrigin, currentPubkey));
    setSort(readSidebarProjectsSort(relayOrigin, currentPubkey));
    setFolderStore(readProjectFolderStore(relayOrigin, currentPubkey));
  }, [currentPubkey, relayOrigin]);
  const updateFolders = (
    change: (store: ProjectFolderStore) => ProjectFolderStore,
  ) => {
    setFolderStore((current) => {
      const next = change(current);
      if (next !== current) {
        writeProjectFolderStore(next, relayOrigin, currentPubkey);
      }
      return next;
    });
  };
  const addedProjectAddressSet = React.useMemo(
    () => new Set(addedProjectAddresses),
    [addedProjectAddresses],
  );
  const projects = React.useMemo(
    () =>
      listSidebarProjects({
        addedProjectAddresses: addedProjectAddressSet,
        currentPubkey,
        filter,
        projects: projectsQuery.data ?? [],
        sort,
      }),
    [addedProjectAddressSet, currentPubkey, filter, projectsQuery.data, sort],
  );
  const groupedProjects = React.useMemo(
    () => groupProjectsByFolder(projects, folderStore),
    [folderStore, projects],
  );
  const channelsById = React.useMemo(
    () =>
      new Map(
        (channelsQuery.data ?? []).map((channel) => [channel.id, channel]),
      ),
    [channelsQuery.data],
  );
  const handleFilterChange = (next: SidebarProjectsFilter) => {
    setFilter(next);
    writeSidebarProjectsFilter(next, relayOrigin, currentPubkey);
  };
  const handleSortChange = (next: SidebarProjectsSort) => {
    setSort(next);
    writeSidebarProjectsSort(next, relayOrigin, currentPubkey);
  };
  const setProjectExpanded = (project: Project, expanded: boolean) => {
    setProjectExpansion((current) => {
      const next = { ...current, [project.projectAddress]: expanded };
      writeSidebarProjectExpansion(next, relayOrigin, currentPubkey);
      return next;
    });
  };
  const handleAdd = (project: Project) => {
    addProjectToSidebar(project.projectAddress, relayOrigin, currentPubkey);
  };
  const handleRemove = (project: Project) => {
    removeProjectFromSidebar(
      project.projectAddress,
      relayOrigin,
      currentPubkey,
    );
    if (
      routeProjectId != null &&
      projectMatchesRouteId(project, routeProjectId)
    ) {
      void goProjects();
    }
  };

  const handleDelete = React.useCallback(
    async (project: Project) => {
      try {
        await deleteProjectMutation.mutateAsync(project);
        removeProjectFromSidebar(
          project.projectAddress,
          relayOrigin,
          currentPubkey,
        );
        toast.success("Project deleted");
        if (
          routeProjectId != null &&
          projectMatchesRouteId(project, routeProjectId)
        ) {
          await goProjects();
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete project",
        );
      } finally {
        setProjectToDelete(null);
      }
    },
    [
      currentPubkey,
      deleteProjectMutation,
      goProjects,
      relayOrigin,
      routeProjectId,
    ],
  );

  const renderProject = (project: Project) => {
    const isActive =
      routeProjectId != null && projectMatchesRouteId(project, routeProjectId);
    const childChannels = listProjectChildChannels(project).flatMap(
      (binding) => {
        const channel = channelsById.get(binding.channelId);
        return channel ? [{ binding, channel }] : [];
      },
    );
    const isExpanded =
      childChannels.length > 0 &&
      (projectExpansion[project.projectAddress] ?? false);

    return (
      <React.Fragment key={project.id}>
        <DraggableChannelRow channelId={project.projectAddress}>
          <SidebarProjectRow
            canDelete={canDeleteProject(project, currentPubkey, ownerProfiles)}
            childCount={childChannels.length}
            deleteDisabled={deleteProjectMutation.isPending}
            isActive={isActive}
            isExpanded={isExpanded}
            onDelete={() => setProjectToDelete(project)}
            onOpen={() => {
              void goProject(project.id);
            }}
            onRemove={() => handleRemove(project)}
            onToggleExpanded={() => setProjectExpanded(project, !isExpanded)}
            folderMenu={
              <ProjectFolderMoveMenu
                currentFolderId={
                  folderStore.assignments[project.projectAddress] ?? null
                }
                folders={folderStore.folders}
                onCreateFolder={() =>
                  setFolderDialog({
                    mode: "create",
                    projectAddress: project.projectAddress,
                  })
                }
                onMove={(folderId) =>
                  updateFolders((store) =>
                    assignProjectToFolder(
                      store,
                      project.projectAddress,
                      folderId,
                    ),
                  )
                }
              />
            }
            project={project}
          />
        </DraggableChannelRow>
        {isExpanded
          ? childChannels.map(({ binding, channel }) => {
              const ChannelIcon =
                channel.visibility === "private" ? Lock : Hash;
              return (
                <SidebarMenuItem
                  key={`${project.id}:${binding.role}:${channel.id}`}
                >
                  <SidebarMenuButton
                    className="h-(--sidebar-subrow-height) pl-7 text-sidebar-foreground/70 data-[active=true]:!bg-transparent data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-none data-[active=true]:hover:!bg-transparent data-[active=true]:hover:text-sidebar-foreground data-[active=true]:active:!bg-transparent"
                    data-testid={`sidebar-project-channel-${project.dtag}-${channel.name}`}
                    isActive={channel.id === routeChannelId}
                    onClick={() => {
                      void goChannel(channel.id);
                    }}
                    tooltip={`#${channel.name}`}
                    type="button"
                  >
                    <ChannelIcon className="h-3.5 w-3.5" />
                    <SidebarMenuLabel>{`#${channel.name}`}</SidebarMenuLabel>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })
          : null}
      </React.Fragment>
    );
  };

  return (
    <SidebarGroup
      className="group/sidebar-section select-none"
      data-section-actions-open={actionsOpen || undefined}
      data-testid="sidebar-projects-section"
    >
      <div className="relative">
        <SidebarGroupLabel asChild>
          <button
            aria-controls="sidebar-projects"
            aria-expanded={!collapsed}
            className={SECTION_LABEL_BUTTON_CLASS}
            data-testid="sidebar-projects-section-label"
            onClick={() => setCollapsed((current) => !current)}
            type="button"
          >
            <span data-sidebar-section-title>Projects</span>
            <span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
              <ChevronDown
                className={cn(
                  SECTION_LABEL_CHEVRON_ICON_CLASS,
                  collapsed ? "-rotate-90" : "rotate-0",
                )}
              />
            </span>
          </button>
        </SidebarGroupLabel>
        <SidebarProjectsHeaderActions
          filter={filter}
          onBrowseAll={() => void goProjects()}
          onCreate={() => setBrowserOpen(true)}
          onCreateFolder={() =>
            setFolderDialog({ mode: "create", projectAddress: null })
          }
          onFilterChange={handleFilterChange}
          onOpenChange={setActionsOpen}
          onSortChange={handleSortChange}
          sort={sort}
        />
      </div>
      {!collapsed ? (
        <SidebarGroupContent id="sidebar-projects">
          {projects.length > 0 ? (
            <SidebarDndContext
              channels={projects.map((project) => ({
                id: project.projectAddress,
                name: project.name,
              }))}
              itemOverlayIcon={<ProjectChannelIcon className="opacity-60" />}
              onAssignChannel={(projectAddress, folderId) =>
                updateFolders((store) =>
                  assignProjectToFolder(store, projectAddress, folderId),
                )
              }
              onReorderSections={(orderedIds) =>
                updateFolders((store) =>
                  reorderProjectFolders(store, orderedIds),
                )
              }
              onUnassignChannel={(projectAddress) =>
                updateFolders((store) =>
                  assignProjectToFolder(store, projectAddress, null),
                )
              }
              sectionIds={folderStore.folders.map((folder) => folder.id)}
              sections={folderStore.folders}
            >
              <SidebarMenu data-testid="sidebar-projects">
                {/* Dropping here takes a project out of its folder; the
                  min height keeps a target when every project is filed. */}
                <DroppableUngroupedBody
                  className={cn(
                    "flex flex-col gap-(--sidebar-row-gap)",
                    folderStore.folders.length > 0 && "min-h-2",
                  )}
                >
                  {groupedProjects.ungrouped.map(renderProject)}
                </DroppableUngroupedBody>
                {groupedProjects.folders.map(({ folder, projects: filed }) => {
                  const isFolderCollapsed =
                    folderStore.collapsed[folder.id] === true;
                  return (
                    <SortableSectionShell key={folder.id} sectionId={folder.id}>
                      {({ dragHandleProps, isDragging }) => (
                        <DroppableSectionBody
                          className="flex flex-col gap-(--sidebar-row-gap)"
                          sectionId={folder.id}
                        >
                          <ProjectFolderRow
                            collapsed={isFolderCollapsed}
                            count={filed.length}
                            dragHandleProps={dragHandleProps}
                            folder={folder}
                            isDragging={isDragging}
                            onDelete={() =>
                              updateFolders((store) =>
                                removeProjectFolder(store, folder.id),
                              )
                            }
                            onRename={() =>
                              setFolderDialog({ mode: "rename", folder })
                            }
                            onToggle={() =>
                              updateFolders((store) =>
                                setProjectFolderCollapsed(
                                  store,
                                  folder.id,
                                  !isFolderCollapsed,
                                ),
                              )
                            }
                          />
                          {isFolderCollapsed ? null : filed.map(renderProject)}
                        </DroppableSectionBody>
                      )}
                    </SortableSectionShell>
                  );
                })}
              </SidebarMenu>
            </SidebarDndContext>
          ) : isPending ? null : (
            <p className="px-2 py-1 text-xs text-sidebar-foreground/50">
              No projects yet
            </p>
          )}
        </SidebarGroupContent>
      ) : null}
      <ProjectBrowserDialog
        isCreating={createProjectMutation.isPending}
        onCreate={async (input) => {
          const result = await createProjectMutation.mutateAsync(input);
          if (result.compatibilityWarning) {
            toast.warning("Created as a standalone project", {
              description: result.compatibilityWarning,
            });
          } else {
            toast.success(`Project "${result.project.name}" created.`);
          }
          await goProject(result.project.id);
        }}
        onOpenChange={setBrowserOpen}
        onSelectProject={(project) => {
          handleAdd(project);
          void goProject(project.id);
        }}
        open={browserOpen}
        projects={projectsQuery.data ?? []}
        selectedProjectAddresses={addedProjectAddressSet}
      />
      <SectionNameDialog
        confirmLabel={folderDialog?.mode === "rename" ? "Save" : "Create"}
        description={
          folderDialog?.mode === "rename"
            ? "Enter a new name for this folder."
            : "Folders group projects in the sidebar on this device."
        }
        initialIcon={
          folderDialog?.mode === "rename" ? folderDialog.folder.icon : undefined
        }
        initialValue={
          folderDialog?.mode === "rename" ? folderDialog.folder.name : ""
        }
        isConfirmDisabled={(trimmed) => trimmed.length === 0}
        onConfirm={(value) => {
          const dialog = folderDialog;
          if (!dialog) return;
          if (dialog.mode === "rename") {
            updateFolders((store) =>
              renameProjectFolder(
                store,
                dialog.folder.id,
                value.name,
                value.icon,
              ),
            );
          } else {
            const id = crypto.randomUUID();
            updateFolders((store) => {
              const withFolder = addProjectFolder(
                store,
                id,
                value.name,
                value.icon,
              );
              return dialog.projectAddress
                ? assignProjectToFolder(withFolder, dialog.projectAddress, id)
                : withFolder;
            });
          }
          setFolderDialog(null);
        }}
        onOpenChange={(open) => {
          if (!open) setFolderDialog(null);
        }}
        open={folderDialog != null}
        title={folderDialog?.mode === "rename" ? "Rename folder" : "New folder"}
      />
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setProjectToDelete(null);
        }}
        open={projectToDelete != null}
      >
        <AlertDialogContent
          data-testid={
            projectToDelete
              ? `sidebar-project-delete-confirm-${projectToDelete.dtag}`
              : undefined
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {projectToDelete?.name} from Projects for everyone. This
              can only be done for projects you own and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button
                disabled={deleteProjectMutation.isPending}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                data-testid={
                  projectToDelete
                    ? `sidebar-project-delete-confirm-button-${projectToDelete.dtag}`
                    : undefined
                }
                disabled={deleteProjectMutation.isPending || !projectToDelete}
                onClick={(event) => {
                  event.preventDefault();
                  if (projectToDelete) void handleDelete(projectToDelete);
                }}
                type="button"
                variant="destructive"
              >
                {deleteProjectMutation.isPending
                  ? "Deleting..."
                  : "Delete project"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarGroup>
  );
}

function SidebarProjectsHeaderActions({
  filter,
  onBrowseAll,
  onCreate,
  onCreateFolder,
  onFilterChange,
  onOpenChange,
  onSortChange,
  sort,
}: {
  filter: SidebarProjectsFilter;
  onBrowseAll: () => void;
  onCreate: () => void;
  onCreateFolder: () => void;
  onFilterChange: (filter: SidebarProjectsFilter) => void;
  onOpenChange: (open: boolean) => void;
  onSortChange: (sort: SidebarProjectsSort) => void;
  sort: SidebarProjectsSort;
}) {
  const actionsTriggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
      <button
        aria-label="Add project"
        className={cn(
          SECTION_ICON_BUTTON_CLASS,
          SECTION_ACTION_VISIBILITY_CLASS,
        )}
        data-testid="sidebar-projects-create"
        onClick={(event) => {
          event.stopPropagation();
          onCreate();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        title="Add project"
        type="button"
      >
        <Plus className="h-4 w-4" />
      </button>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="More actions for Projects"
            className={cn(
              SECTION_ICON_BUTTON_CLASS,
              SECTION_ACTION_VISIBILITY_CLASS,
            )}
            data-testid="sidebar-projects-settings"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            ref={actionsTriggerRef}
            type="button"
          >
            <EllipsisVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            actionsTriggerRef.current?.blur();
          }}
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Folders className="h-4 w-4" />
              <span>Show</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onFilterChange(value as SidebarProjectsFilter)
                }
                value={filter}
              >
                <DropdownMenuRadioItem value="added">
                  Added
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="owned">
                  Owned by me
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowUpDown className="h-4 w-4" />
              <span>Sort</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  onSortChange(value as SidebarProjectsSort)
                }
                value={sort}
              >
                <DropdownMenuRadioItem value="name">A–Z</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="created">
                  Newest
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => deferMenuAction(onCreateFolder)}>
            <FolderPlus className="h-4 w-4" />
            <span>New folder…</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => deferMenuAction(onBrowseAll)}>
            <Folder className="h-4 w-4" />
            <span>Browse all projects</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SidebarProjectRow({
  canDelete,
  childCount,
  deleteDisabled,
  folderMenu,
  isActive,
  isExpanded,
  onDelete,
  onOpen,
  onRemove,
  onToggleExpanded,
  project,
}: {
  canDelete: boolean;
  childCount: number;
  deleteDisabled: boolean;
  /** "Move to folder" submenu for this project. */
  folderMenu: React.ReactNode;
  isActive: boolean;
  isExpanded: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onToggleExpanded: () => void;
  project: Project;
}) {
  const shareLink = projectShareLink(project);
  const hasChildren = childCount > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem>
          <SidebarMenuButton
            className={cn(
              "data-[active=true]:!bg-transparent data-[active=true]:font-normal data-[active=true]:text-sidebar-foreground data-[active=true]:shadow-none data-[active=true]:hover:!bg-transparent data-[active=true]:hover:text-sidebar-foreground data-[active=true]:active:!bg-transparent",
              hasChildren && "pr-8",
            )}
            data-testid={`sidebar-project-${project.dtag}`}
            isActive={isActive}
            onClick={onOpen}
            tooltip={project.name}
            type="button"
          >
            <ProjectChannelIcon className={cn(!isActive && "opacity-80")} />
            <SidebarMenuLabel className={cn(!isActive && "opacity-80")}>
              {project.name}
            </SidebarMenuLabel>
          </SidebarMenuButton>
          {hasChildren ? (
            <SidebarMenuAction
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? `Hide channels in ${project.name}`
                  : `Show channels in ${project.name}`
              }
              data-testid={`sidebar-project-expand-${project.dtag}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded();
              }}
              type="button"
            >
              <ChevronRight
                className={cn(
                  "transition-transform duration-150",
                  isExpanded && "rotate-90",
                )}
              />
            </SidebarMenuAction>
          ) : null}
          {canDelete && !hasChildren ? (
            <SidebarMenuAction
              aria-label={`Delete ${project.name}`}
              data-testid={`sidebar-project-delete-${project.dtag}`}
              disabled={deleteDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              showOnHover
              type="button"
            >
              <Trash2 />
            </SidebarMenuAction>
          ) : null}
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => deferMenuAction(onRemove)}>
          <ContextMenuIconSlot>
            <ListMinus className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>Remove from sidebar</span>
        </ContextMenuItem>
        {folderMenu}
        {shareLink ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() =>
                deferMenuAction(() =>
                  copyTextToClipboard(shareLink, "Link copied to clipboard"),
                )
              }
            >
              <ContextMenuIconSlot>
                <Link2 className="h-4 w-4" />
              </ContextMenuIconSlot>
              <span>Copy link</span>
            </ContextMenuItem>
          </>
        ) : null}
        {canDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              data-testid={`sidebar-project-delete-menu-${project.dtag}`}
              disabled={deleteDisabled}
              onSelect={() => deferMenuAction(onDelete)}
            >
              <ContextMenuIconSlot>
                <Trash2 className="h-4 w-4" />
              </ContextMenuIconSlot>
              <span>Delete project</span>
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
