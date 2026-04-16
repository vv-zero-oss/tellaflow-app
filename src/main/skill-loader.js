const path = require('path');
const fs = require('fs');

let toolRegistry = null; // Map<toolName, { execute, skill }>

/**
 * Load all built-in skills and any user skills from userData/skills/.
 * Returns a flat registry of all tool definitions.
 */
function loadSkills() {
  if (toolRegistry) return toolRegistry;

  toolRegistry = new Map();

  const builtinDir = path.join(__dirname, 'skills');
  const skillFiles = fs
    .readdirSync(builtinDir)
    .filter(f => f.endsWith('.js'))
    .map(f => path.join(builtinDir, f));

  // User skills (optional, loaded from userData/skills/)
  try {
    const { app } = require('electron');
    const userSkillDir = path.join(app.getPath('userData'), 'skills');
    if (fs.existsSync(userSkillDir)) {
      const userFiles = fs
        .readdirSync(userSkillDir)
        .filter(f => f.endsWith('.js'))
        .map(f => path.join(userSkillDir, f));
      skillFiles.push(...userFiles);
    }
  } catch (err) {
    // Running outside Electron (tests) — skip user skills
  }

  for (const file of skillFiles) {
    try {
      const skill = require(file);
      for (const tool of skill.tools || []) {
        if (toolRegistry.has(tool.name)) {
          console.warn(`[skill-loader] Duplicate tool name "${tool.name}" from ${file} — skipping`);
          continue;
        }
        toolRegistry.set(tool.name, { tool, skill: skill.name, execute: tool.execute.bind(tool) });
      }
    } catch (err) {
      console.error(`[skill-loader] Failed to load skill ${file}:`, err.message);
    }
  }

  console.log(`[skill-loader] Loaded ${toolRegistry.size} tools from ${skillFiles.length} skills`);
  return toolRegistry;
}

/**
 * Execute a named tool with the given arguments.
 * @param {string} toolName
 * @param {object} args
 * @returns {Promise<string>} — string result to feed back to the agent
 */
async function executeTool(toolName, args = {}) {
  const registry = loadSkills();
  const entry = registry.get(toolName);
  if (!entry) {
    throw new Error(`Unknown tool: "${toolName}". Available tools: ${[...registry.keys()].join(', ')}`);
  }
  const result = await entry.execute(args);
  return String(result ?? '');
}

/**
 * Return all tool definitions formatted as a JSON Schema array for the LLM system prompt.
 */
function getToolDefinitions() {
  const registry = loadSkills();
  return [...registry.values()].map(({ tool, skill }) => ({
    name: tool.name,
    description: `[${skill}] ${tool.description}`,
    parameters: tool.parameters || {},
  }));
}

/**
 * Reload skills — clears the cache so loadSkills() rebuilds on next call.
 */
function reloadSkills() {
  toolRegistry = null;
}

module.exports = { loadSkills, executeTool, getToolDefinitions, reloadSkills };
