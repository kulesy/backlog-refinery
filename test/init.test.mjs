import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../scripts/init.mjs';

const opt = (id, name) => ({ id, name });
const list = { fields: [
  { id: 'F_title', name: 'Title', type: 'ProjectV2Field' },
  { id: 'F_status', name: 'Status', type: 'ProjectV2SingleSelectField', options: [
    opt('s1', 'Needs Triage'), opt('s2', 'Backlog - Not Ready'), opt('s3', 'Backlog - Ready'), opt('s4', 'In progress'), opt('s5', 'Done'), opt('s6', "Won't do") ] },
  { id: 'F_est', name: 'Estimate', type: 'ProjectV2Field' },
  { id: 'F_score', name: 'Priority Score', type: 'ProjectV2Field' },
  { id: 'F_prio', name: 'Priority', type: 'ProjectV2SingleSelectField', options: [opt('p1', 'urgent'), opt('p2', 'High'), opt('p3', 'Medium'), opt('p4', 'LOW')] },
] };

test('maps a full board', () => {
  const { config, problems } = buildConfig({ owner: 'acme', projectNumber: '7', view: { id: 'PVT_1', title: 'Acme board' }, list });
  assert.deepEqual(problems, []);
  assert.equal(config.projectId, 'PVT_1');
  assert.equal(config.boardName, 'Acme board');
  assert.deepEqual(config.fields, { status: 'F_status', estimate: 'F_est', score: 'F_score', priority: 'F_prio' });
  assert.deepEqual(config.statusOptions, { needsTriage: 's1', notReady: 's2', ready: 's3', done: 's5', wontDo: 's6' });
  assert.deepEqual(config.priorityOptions, { Urgent: 'p1', High: 'p2', Medium: 'p3', Low: 'p4' });
  assert.deepEqual(config.statuses, ['Needs Triage', 'Backlog - Not Ready', 'Backlog - Ready', 'In progress']);
  assert.equal(config.triageStatus, 'Needs Triage');
  assert.equal(config.notReadyStatus, 'Backlog - Not Ready');
  assert.deepEqual([config.repos, config.privateRepos, config.port, config.dor], [[], [], 4380, { gitmoji: false, evidence: false }]);
});

test('reports what it could not map', () => {
  const { config, problems } = buildConfig({ owner: 'acme', projectNumber: 7, view: {}, list: { fields: [{ id: 'F_status', name: 'Status', options: [opt('s1', 'Todo')] }] } });
  assert.equal(config.fields.score, undefined);
  assert.equal(config.boardName, 'acme project 7');
  assert.ok(problems.some(p => /project id/.test(p)));
  assert.ok(problems.some(p => /needsTriage/.test(p)));
  assert.ok(problems.some(p => /Estimate/.test(p)));
  assert.ok(problems.some(p => /Priority single-select/.test(p)));
});

test('survives empty or malformed gh output', () => {
  for (const bad of [undefined, null, {}, { fields: null }, { fields: [null, {}] }]) {
    assert.doesNotThrow(() => buildConfig({ owner: 'a', projectNumber: 1, view: null, list: bad }));
  }
});

test('ready does not match not ready', () => {
  const l = { fields: [{ id: 'S', name: 'Status', options: [opt('a', 'Not Ready'), opt('b', 'Ready')] }] };
  const { config } = buildConfig({ owner: 'a', projectNumber: 1, view: { id: 'x' }, list: l });
  assert.deepEqual([config.statusOptions.notReady, config.statusOptions.ready], ['a', 'b']);
});
