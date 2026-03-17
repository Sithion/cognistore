import { confirm, select } from '@inquirer/prompts';

export async function confirmAction(message: string, defaultValue = true): Promise<boolean> {
  return confirm({ message, default: defaultValue });
}

export async function selectOption<T extends string>(
  message: string,
  choices: { name: string; value: T }[]
): Promise<T> {
  return select({ message, choices });
}
