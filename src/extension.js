/**
 * Copyright 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import * as constants from './constants';
import * as utils from './utils';

import InstallationManager from './installer/manager';
import ProjectIndexer from './project/indexer';
import initCommand from './commands/init';
import path from 'path';
import semver from 'semver';
import vscode from 'vscode';

export default class PlatformIOVSCodeExtension {

  constructor() {
    this.activate = this.activate.bind(this);
  }

  async activate(context) {
    if (!vscode.workspace.rootPath) {
      return;
    }
    utils.updateOSEnviron();

    await this.startInstaller(context.globalState, context.extensionPath);

    const indexer = new ProjectIndexer(vscode.workspace.rootPath);
    context.subscriptions.push(indexer);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => indexer.toggle()));
    await indexer.toggle();

    // Create Terminal Instance with pre-configured environment PATH
    this.initTerminal();

    context.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.newTerminal',
        () => this.initTerminal().show())
    );    
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.initProject',
        initCommand)
    );
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'platformio-ide.rebuildProjectIndex',
        () => indexer.doRebuild({
          verbose: true,
        }))
    );
  }

  initTerminal() {
    const terminal = vscode.window.createTerminal('PlatformIO');
    if (constants.IS_WINDOWS) {
      terminal.sendText('set PATH=' + process.env.PATH);
    } else if (process.env.SHELL && process.env.SHELL.includes('fish')) {
      terminal.sendText('set -gx PATH ' + process.env.PATH.replace(/\:/g, ' '));
    } else {
      terminal.sendText('export PATH=' + process.env.PATH);
    }    
    terminal.sendText('pio --help');
    return terminal;
  }

  startInstaller(globalState, extensionPath) {
    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: 'PlatformIO',
    }, async (progress) => {
      progress.report({
        message: 'Verifying PlatformIO Core installation...',
      });

      const cacheDir = path.join(extensionPath, '.cache');
      await utils.ensureDirExists(cacheDir);

      const config = vscode.workspace.getConfiguration('platformio-ide');
      const isPrerelease = Boolean(semver.prerelease(utils.getIDEVersion()));
      const im = new InstallationManager(globalState, config, cacheDir, isPrerelease);

      if (im.locked()) {
        vscode.window.showInformationMessage(
          'PlatformIO IDE installation has been suspended, because PlatformIO '
          + 'IDE Installer is already started in another window.');
      } else if (await im.check()) {
        return;
      } else {
        progress.report({
          message: 'Installing PlatformIO IDE...',
        });
        const outputChannel = vscode.window.createOutputChannel('PlatformIO Instalation');
        outputChannel.show();

        outputChannel.appendLine('Installing PlatformIO Core...');
        outputChannel.appendLine("Please don't close this window and don't "
          + 'open other folders until this process is completed.');

        try {
          im.lock();
          await im.install();
          outputChannel.appendLine('PlatformIO IDE installed successfully.');
        } catch (err) {
          vscode.window.showErrorMessage(err.toString(), {
            modal: true,
          });
          outputChannel.appendLine('Failed to install PlatformIO IDE.');
        } finally {
          im.unlock();
        }
      }
      im.destroy();
      return Promise.reject(null);
    });
  }
}
