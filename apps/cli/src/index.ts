#!/usr/bin/env node
import { Command } from 'commander';
import {
  addCommand,
  searchCommand,
  updateCommand,
  deleteCommand,
  tagsCommand,
  healthCommand,
  dbStatusCommand,
  installCommand,
  uninstallCommand,
} from './commands/index.js';

const program = new Command()
  .name('kb')
  .description('AI Knowledge Base CLI — Semantic knowledge management for AI agents')
  .version('0.4.0');

program.addCommand(installCommand);
program.addCommand(uninstallCommand);
program.addCommand(addCommand);
program.addCommand(searchCommand);
program.addCommand(updateCommand);
program.addCommand(deleteCommand);
program.addCommand(tagsCommand);
program.addCommand(healthCommand);
program.addCommand(dbStatusCommand);

program.parse();
