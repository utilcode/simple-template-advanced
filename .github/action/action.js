#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { default: reflect } = require('./reflect');
const { default: axios } = require('axios');

const GITHUB_TOKEN = argv.github;
const OWNER_NAME = argv.owner;
const CURRENT_REPO = argv.repo;

//scan new npm packages
// const keywords = argv.keywords || 'api';

function random(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function getListPackageByKeywords(keyword) {
  const x = await axios.get('https://registry.npmjs.org/-/v1/search', {
    responseType: 'json',
    params: {
      text: `keywords:${keyword} not:insecure,unstable`,
      quality: '0.8',
      popularity: '0.8',
    },
  });

  return x.data.objects;
}

const PARENT_FOLDER = path.resolve(__dirname, '../..');

async function main() {
  // latested packages from NPM
  const res = await axios.get(`https://registry.npmjs.org/-/v1/search`, {
    params: {
      text: 'not:insecure,unstable',
      size: '200',
    },
    responseType: 'json',
  });

  const packages = res.data.objects;

  shuffle(packages);
  console.log('Found packages', packages.length);

  for (const package of packages) {
    const packageName = package.package.name;
    const keywords = package.package.keywords;

    shuffle(keywords);

    console.log('Keywords for package %s: ', packageName, keywords);

    for (const keyword of keywords) {
      const list = await getListPackageByKeywords(keyword);
      if (list.length === 0) {
        continue;
      }

      shuffle(list);

      for (const pkg of list) {
        if (
          !pkg.package.links ||
          !pkg.package.links.repository ||
          !pkg.package.links.repository.startsWith('https://github.com/')
        ) {
          continue;
        }

        const url = pkg.package.links.repository;
        console.log('Try to clone package %s, url: %s', packageName, url);

        // clone to test-folder
        child_process.execSync(
          `git clone "${url}" "${path.join(__dirname, 'test-folder')}"`
        );

        await reflect({
          src: path.join(__dirname, 'test-folder') + '/',
          dest: PARENT_FOLDER + '/',
          overwrite: true,
          delete: true,
          ignore: ['.github'],
        });

        console.log('Copied data');

        const ORI_PACKAGE_JSON = JSON.parse(
          fs.readFileSync(path.join(PARENT_FOLDER, 'package.json'), {
            encoding: 'utf-8',
          })
        );

        //
        const { data: repos } = axios.get(
          `https://api.github.com/orgs/${OWNER_NAME}/repos`,
          {
            headers: {
              Authorization: `Bearer ${GITHUB_TOKEN}`,
              Accept: 'application/vnd.github.v3+json',
            },
            responseType: 'json',
          }
        );

        for (const repo of repos) {
          if (repo.full_name === CURRENT_REPO) {
            console.log('Skip repo %s due to current repo', repo.full_name);
            continue;
          }

          try {
            const { data: packageJSON } = axios.get(
              `https://raw.githubusercontent.com/${repo.full_name}/main/package.json`,
              {
                headers: {
                  Authorization: `Bearer ${GITHUB_TOKEN}`,
                },
                responseType: 'json',
              }
            );

            if (packageJSON.name.includes('test')) {
              console.log('Skip repo %s due to test package', repo.full_name);
              continue;
            }

            ORI_PACKAGE_JSON.dependencies[packageJSON.name] =
              '^' + packageJSON.version;
          } catch (err) {
            console.error('Skip repo %s due to error: ', repo.full_name, err);
          }
        }
        //write back
        fs.writeFileSync(
          path.join(PARENT_FOLDER, 'package.json'),
          JSON.stringify(ORI_PACKAGE_JSON, null, 2)
        );

        console.log('Done!');

        return;
      }
    }
  }
}

main();
