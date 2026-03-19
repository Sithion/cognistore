export interface PlanTemplate {
  id: string;
  name: string;
  icon: string;
  titlePattern: string;
  contentStructure: string;
  defaultTags: string[];
  tasks: { description: string; priority: 'high' | 'medium' | 'low' }[];
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    icon: '📄',
    titlePattern: '',
    contentStructure: '',
    defaultTags: [],
    tasks: [],
  },
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    icon: '🐛',
    titlePattern: 'Fix: ',
    contentStructure: '## Problem\n\n\n\n## Root Cause\n\n\n\n## Solution\n\n\n\n## Verification\n\n',
    defaultTags: ['bug', 'fix'],
    tasks: [
      { description: 'Reproduce the bug', priority: 'high' },
      { description: 'Identify root cause', priority: 'high' },
      { description: 'Implement fix', priority: 'high' },
      { description: 'Write tests', priority: 'medium' },
      { description: 'Verify fix', priority: 'medium' },
    ],
  },
  {
    id: 'feature',
    name: 'Feature',
    icon: '✨',
    titlePattern: 'Feature: ',
    contentStructure: '## Goal\n\n\n\n## Approach\n\n\n\n## Dependencies\n\n\n\n## Acceptance Criteria\n\n',
    defaultTags: ['feature'],
    tasks: [
      { description: 'Design solution', priority: 'high' },
      { description: 'Implement core logic', priority: 'high' },
      { description: 'Add tests', priority: 'medium' },
      { description: 'Update documentation', priority: 'low' },
    ],
  },
  {
    id: 'refactoring',
    name: 'Refactoring',
    icon: '🔧',
    titlePattern: 'Refactor: ',
    contentStructure: '## Current State\n\n\n\n## Target State\n\n\n\n## Approach\n\n\n\n## Risk Assessment\n\n',
    defaultTags: ['refactoring'],
    tasks: [
      { description: 'Analyze current code', priority: 'high' },
      { description: 'Plan refactoring steps', priority: 'high' },
      { description: 'Refactor', priority: 'high' },
      { description: 'Verify no regressions', priority: 'high' },
    ],
  },
  {
    id: 'investigation',
    name: 'Investigation',
    icon: '🔍',
    titlePattern: 'Investigate: ',
    contentStructure: '## Question\n\n\n\n## Hypotheses\n\n\n\n## Findings\n\n\n\n## Conclusion\n\n',
    defaultTags: ['investigation'],
    tasks: [
      { description: 'Define scope', priority: 'high' },
      { description: 'Research', priority: 'high' },
      { description: 'Document findings', priority: 'medium' },
      { description: 'Recommend next steps', priority: 'medium' },
    ],
  },
];
