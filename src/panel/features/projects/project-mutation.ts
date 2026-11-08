export type ProjectRemoval = {
  deleteTasks: boolean;
  deleteAgentTasks?: boolean;
  confirmation?: string;
};

type ProjectMutationClient = {
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
};

/** Keeps reviewed removal arguments separate from rename arguments. */
export function mutateProject(
  client: ProjectMutationClient,
  repository: string,
  name: string | undefined,
  { deleteTasks, deleteAgentTasks = false, confirmation }: ProjectRemoval,
) {
  const request =
    name === undefined
      ? {
          tool: "app_remove_project",
          args: {
            repository,
            delete_tasks: deleteTasks,
            ...(deleteTasks
              ? { confirmation, delete_agent_task: deleteAgentTasks }
              : {}),
          },
        }
      : { tool: "app_rename_project", args: { repository, name } };

  return client.tool<{ name?: string }>(request.tool, request.args);
}
