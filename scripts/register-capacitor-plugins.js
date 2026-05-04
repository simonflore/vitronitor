#!/usr/bin/env node

/**
 * Re-register custom Capacitor plugins after `npx cap sync`.
 *
 * `cap sync` regenerates Package.swift + capacitor.config.json + the Android
 * plugin registration files, which wipes any custom plugin entries. Run this
 * after every sync to put them back. (Already wired into `npm run cap:sync`.)
 *
 * To add a custom plugin, append to CUSTOM_PLUGINS below.
 *
 * Boilerplate ships with NO custom plugins — the array is empty, and the
 * script is a no-op until you add one. The official Capacitor plugin
 * scaffold (`npm init @capacitor/plugin@latest`) generates a fresh package
 * under plugins/ that you then append to CUSTOM_PLUGINS here.
 */

const fs = require('fs');
const path = require('path');

const CAPACITOR_CONFIG_PATH = path.join(
  __dirname,
  '../ios/App/App/capacitor.config.json',
);
const PACKAGE_SWIFT_PATH = path.join(__dirname, '../ios/App/CapApp-SPM/Package.swift');
const ANDROID_PLUGINS_JSON_PATH = path.join(
  __dirname,
  '../android/app/src/main/assets/capacitor.plugins.json',
);
const ANDROID_SETTINGS_GRADLE_PATH = path.join(__dirname, '../android/capacitor.settings.gradle');
const ANDROID_BUILD_GRADLE_PATH = path.join(__dirname, '../android/app/capacitor.build.gradle');

/**
 * @typedef {Object} CustomPlugin
 * @property {string} packageName        — Swift package name, e.g. "CapacitorMyPlugin"
 * @property {string} productName        — Swift product name, e.g. "MyPlugin"
 * @property {string} path               — Relative path to the plugin from ios/App/CapApp-SPM/Package.swift
 * @property {string} [androidClasspath] — Java/Kotlin class path, e.g. "com.example.myplugin.MyPlugin"
 * @property {('ios'|'android')[]} platforms
 */

/** @type {CustomPlugin[]} */
const CUSTOM_PLUGINS = [
  // Example (commented out):
  // {
  //   packageName: 'CapacitorMyPlugin',
  //   productName: 'MyPlugin',
  //   path: '../../../plugins/capacitor-my-plugin',
  //   androidClasspath: 'com.example.myplugin.MyPlugin',
  //   platforms: ['ios', 'android'],
  // },
];

if (CUSTOM_PLUGINS.length === 0) {
  console.log('[register-capacitor-plugins] no custom plugins to register, skipping');
  process.exit(0);
}

function fixCapacitorConfig() {
  if (!fs.existsSync(CAPACITOR_CONFIG_PATH)) return false;
  const config = JSON.parse(fs.readFileSync(CAPACITOR_CONFIG_PATH, 'utf8'));
  config.packageClassList ||= [];
  let modified = false;
  for (const p of CUSTOM_PLUGINS) {
    if (!config.packageClassList.includes(p.productName)) {
      config.packageClassList.push(p.productName);
      modified = true;
    }
  }
  if (modified) {
    fs.writeFileSync(CAPACITOR_CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n');
    console.log('[register-capacitor-plugins] updated capacitor.config.json');
  }
  return modified;
}

function fixPackageSwift() {
  if (!fs.existsSync(PACKAGE_SWIFT_PATH)) return false;
  let content = fs.readFileSync(PACKAGE_SWIFT_PATH, 'utf8');
  let modified = false;
  for (const p of CUSTOM_PLUGINS) {
    if (!content.includes(`"${p.packageName}"`)) {
      const m = content.match(/dependencies: \[[\s\S]*?\n(\s*)\],/);
      if (m) {
        const insertPos = m.index + m[0].lastIndexOf('\n') + 1;
        const indent = '        ';
        const entry = `${indent}.package(name: "${p.packageName}", path: "${p.path}"),\n`;
        content = content.slice(0, insertPos) + entry + content.slice(insertPos);
        modified = true;
      }
    }
    if (!content.includes(`"${p.productName}"`)) {
      const targetsIdx = content.indexOf('targets: [');
      if (targetsIdx !== -1) {
        const after = content.slice(targetsIdx);
        const depsIdx = after.indexOf('dependencies: [');
        if (depsIdx !== -1) {
          const m = after.slice(depsIdx).match(/\n(\s*)\]\s*\n/);
          if (m) {
            const insertPos = targetsIdx + depsIdx + m.index + 1;
            const indent = '                ';
            const entry = `${indent}.product(name: "${p.productName}", package: "${p.packageName}"),\n`;
            content = content.slice(0, insertPos) + entry + content.slice(insertPos);
            modified = true;
          }
        }
      }
    }
  }
  if (modified) {
    fs.writeFileSync(PACKAGE_SWIFT_PATH, content);
    console.log('[register-capacitor-plugins] updated Package.swift');
  }
  return modified;
}

function fixAndroidPluginsJson() {
  if (!fs.existsSync(ANDROID_PLUGINS_JSON_PATH)) return false;
  const plugins = JSON.parse(fs.readFileSync(ANDROID_PLUGINS_JSON_PATH, 'utf8'));
  let modified = false;
  for (const p of CUSTOM_PLUGINS) {
    if (!p.platforms.includes('android') || !p.androidClasspath) continue;
    if (!plugins.some((x) => x.classpath === p.androidClasspath)) {
      plugins.push({
        pkg: p.packageName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''),
        classpath: p.androidClasspath,
      });
      modified = true;
    }
  }
  if (modified) {
    fs.writeFileSync(ANDROID_PLUGINS_JSON_PATH, JSON.stringify(plugins, null, '\t') + '\n');
    console.log('[register-capacitor-plugins] updated capacitor.plugins.json');
  }
  return modified;
}

function fixAndroidSettingsGradle() {
  if (!fs.existsSync(ANDROID_SETTINGS_GRADLE_PATH)) return false;
  let content = fs.readFileSync(ANDROID_SETTINGS_GRADLE_PATH, 'utf8');
  let modified = false;
  for (const p of CUSTOM_PLUGINS) {
    if (!p.platforms.includes('android')) continue;
    const name = p.packageName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    if (!content.includes(`':${name}'`)) {
      const androidPath = p.path.replace(/^\.\.\/\.\.\/\.\.\//, '../');
      content += `\ninclude ':${name}'\nproject(':${name}').projectDir = new File('${androidPath}/android')\n`;
      modified = true;
    }
  }
  if (modified) {
    fs.writeFileSync(ANDROID_SETTINGS_GRADLE_PATH, content);
    console.log('[register-capacitor-plugins] updated capacitor.settings.gradle');
  }
  return modified;
}

function fixAndroidBuildGradle() {
  if (!fs.existsSync(ANDROID_BUILD_GRADLE_PATH)) return false;
  let content = fs.readFileSync(ANDROID_BUILD_GRADLE_PATH, 'utf8');
  let modified = false;
  for (const p of CUSTOM_PLUGINS) {
    if (!p.platforms.includes('android')) continue;
    const name = p.packageName.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    const dep = `implementation project(':${name}')`;
    if (!content.includes(dep)) {
      const i = content.indexOf('dependencies {');
      if (i !== -1) {
        const j = i + content.slice(i).indexOf('\n}');
        if (j > i) {
          content = content.slice(0, j) + `\n    ${dep}` + content.slice(j);
          modified = true;
        }
      }
    }
  }
  if (modified) {
    fs.writeFileSync(ANDROID_BUILD_GRADLE_PATH, content);
    console.log('[register-capacitor-plugins] updated capacitor.build.gradle');
  }
  return modified;
}

let any = false;
any = fixCapacitorConfig() || any;
any = fixPackageSwift() || any;
any = fixAndroidPluginsJson() || any;
any = fixAndroidSettingsGradle() || any;
any = fixAndroidBuildGradle() || any;

if (any) console.log('[register-capacitor-plugins] done — rebuild to apply');
else console.log('[register-capacitor-plugins] all registrations already in sync');
