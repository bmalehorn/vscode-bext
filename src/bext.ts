"use strict";

// tslint:disable-next-line
import * as vscode from "vscode";
// tslint:disable-next-line
import { Range, Selection, TextEditorRevealType } from "vscode";
const { executeCommand } = vscode.commands;
import { pickBy, values } from "lodash";

interface IBranch {
  selecting?: Action;
  default: Action;
}

type Action = string | string[] | IBranch | IKeymap;

interface IKeymap {
  [key: string]: Action;
}

let typeSubscription: vscode.Disposable | undefined;
let zeroWidthSelecting = false;
let rootKeymap: IKeymap = {};
let normalMode = true;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.enterNormal", enterNormal),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.enterInsert", enterInsert),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.toggleSelection", toggleSelection),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.moveDown", moveDown),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.moveUp", moveUp),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bext.swapActiveAndAnchor",
      swapActiveAndAnchor,
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.copyWord", copyWord),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("bext.cancelSelection", cancelSelection),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(updateKeymapFromConfiguration),
  );
  updateKeymapFromConfiguration();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateCursor),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(events =>
      events.forEach(updateCursor),
    ),
  );

  enterNormal();
}

// this method is called when your extension is deactivated
export function deactivate() {
  enterInsert();
}

function enterNormal() {
  if (!typeSubscription) {
    typeSubscription = vscode.commands.registerCommand("type", onType);
  }
  setNormal(true);
}

function enterInsert() {
  if (typeSubscription) {
    typeSubscription.dispose();
    typeSubscription = undefined;
  }
  setNormal(false);
}

function updateCursor(editor: vscode.TextEditor | undefined): void {
  if (!editor) {
    return;
  }
  editor.options.cursorStyle = normalMode
    ? vscode.TextEditorCursorStyle.Block
    : vscode.TextEditorCursorStyle.Underline;
}

async function setNormal(normal: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  await executeCommand("setContext", "bext.normal", normal);
  normalMode = normal;
  updateCursor(editor);
  cancelSelection();
}

function updateKeymapFromConfiguration(): void {
  const userKeybindings =
    vscode.workspace.getConfiguration("bext.keybindings") || {};
  rootKeymap = pickBy(userKeybindings, isAction);
  keymap = rootKeymap;
}

function isAction(x: any): x is Action {
  return isString(x) || isStringList(x) || isBranch(x) || isKeymap(x);
}

function isString(x: any): x is string {
  return typeof x === "string";
}

function isStringList(x: any): x is string[] {
  return Array.isArray(x) && x.every(element => isString(element));
}

function isBranch(x: any): x is IBranch {
  if (x === null || typeof x !== "object" || !x.default) {
    return false;
  }
  if (x.selecting && !isAction(x.selecting)) {
    return false;
  }
  if (!isAction(x.default)) {
    return false;
  }
  return true;
}

function isKeymap(x: any): x is IKeymap {
  return (
    x !== null &&
    typeof x === "object" &&
    !isBranch(x) &&
    values(x).every(isAction)
  );
}

async function evalAction(action: Action | undefined): Promise<void> {
  keymap = rootKeymap;
  if (isString(action)) {
    await executeCommand(action);
  } else if (isStringList(action)) {
    for (const command of action) {
      await executeCommand(command);
    }
  } else if (isBranch(action)) {
    if (getSelecting() && action.selecting) {
      await evalAction(action.selecting);
    } else {
      await evalAction(action.default);
    }
  } else if (isKeymap(action)) {
    keymap = action;
  }
}

/////////////////
// todo:
// - record video in screencast mode
// - fixup cursorStyle on editor focus
// - use "type": "branch" instead of "default" presence

let keymap: IKeymap = rootKeymap;

async function onType(event: { text: string }): Promise<void> {
  adjustSelecting();

  const action = keymap[event.text];
  evalAction(action);
}

/////////////////////////
// commands

async function cancelSelection(): Promise<void> {
  await executeCommand("cancelSelection");
  zeroWidthSelecting = false;
}

async function toggleSelection(): Promise<void> {
  const oldZeroWidthSelecting = zeroWidthSelecting;
  await cancelSelection();
  zeroWidthSelecting = !oldZeroWidthSelecting;
}

function adjustSelecting(): void {
  if (normalSelecting()) {
    zeroWidthSelecting = false;
  }
}

function normalSelecting(): boolean {
  return vscode.window.activeTextEditor!.selections.some(
    selection => !selection.anchor.isEqual(selection.active),
  );
}

function getSelecting(): boolean {
  return normalSelecting() || zeroWidthSelecting;
}

function moveDown(): Promise<void> {
  return _moveDown(10);
}

function moveUp(): Promise<void> {
  return _moveDown(-10);
}

async function _moveDown(lines: number, buffer: number = 1) {
  const editor = vscode.window.activeTextEditor!;
  const { start, end } = editor.visibleRanges[0];
  const newRange = new Range(
    start.with(Math.max(start.line + lines, 0)),
    end.with(Math.max(end.line + lines, 0)),
  );
  editor.revealRange(new Selection(newRange.start, newRange.end));

  // put active inside new revealed range
  if (editor.selection.active.compareTo(newRange.start) < 0) {
    const newPosition = newRange.start.with(newRange.start.line + buffer, 0);
    editor.selection = new Selection(
      getSelecting() ? editor.selection.anchor : newPosition,
      newPosition,
    );
  }
  if (editor.selection.active.compareTo(newRange.end) > 0) {
    const newPosition = newRange.end.with(newRange.end.line - buffer, 0);
    editor.selection = new Selection(
      getSelecting() ? editor.selection.anchor : newPosition,
      newPosition,
    );
  }
}

async function swapActiveAndAnchor() {
  const editor = vscode.window.activeTextEditor!;
  editor.selections = editor.selections.map(
    ({ anchor, active }) => new Selection(active, anchor),
  );
  editor.revealRange(
    new Selection(editor.selection.active, editor.selection.active),
    TextEditorRevealType.Default,
  );
}

async function saveSelections(callback: () => Thenable<void>) {
  const editor = vscode.window.activeTextEditor!;
  const selections = editor.selections;
  await callback();
  editor.selections = selections;
}

async function copyWord(): Promise<void> {
  await saveSelections(async () => {
    await executeCommand("editor.action.addSelectionToNextFindMatch");
    await executeCommand("editor.action.clipboardCopyAction");
  });
}
