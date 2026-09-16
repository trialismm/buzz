import { invokeTauri } from "@/shared/api/tauri";

/** One owner skill folder in a persona's working directory (`persona_workdir.rs`). */
export type PersonaSkill = {
  name: string;
  description: string;
  /** Folder under `.agents/skills`. */
  folder: string;
};

export type PersonaWorkdirInfo = {
  /** Absolute path of the persona's folder. */
  path: string;
  skills: PersonaSkill[];
};

/** The persona's folder (created on first call) and its skills. */
export async function getPersonaWorkdir(
  personaId: string,
): Promise<PersonaWorkdirInfo> {
  return invokeTauri<PersonaWorkdirInfo>("get_persona_workdir", { personaId });
}

/** Opens the OS folder picker; resolves to the folder's new state. */
export async function addPersonaSkill(
  personaId: string,
): Promise<PersonaWorkdirInfo> {
  return invokeTauri<PersonaWorkdirInfo>("add_persona_skill", { personaId });
}

export async function removePersonaSkill(
  personaId: string,
  folder: string,
): Promise<PersonaWorkdirInfo> {
  return invokeTauri<PersonaWorkdirInfo>("remove_persona_skill", {
    personaId,
    folder,
  });
}

export async function revealPersonaWorkdir(personaId: string): Promise<void> {
  await invokeTauri("reveal_persona_workdir", { personaId });
}
