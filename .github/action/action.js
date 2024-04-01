#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const argv = yargs(hideBin(process.argv)).argv;
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const { default: reflect } = require('@alumna/reflect');

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

async function getPackageInfo(packageName) {
  try {
    const pkgDetail = await axios.get(
      `https://api.npms.io/v2/package/${packageName}`,
      {
        responseType: 'json',
      }
    );

    return pkgDetail.data;
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function getKeywordsInfo(packageName) {
  const info = await getPackageInfo(packageName);
  if (info) {
    return info.collected.metadata.keywords;
  }

  return [];
}

async function getListPackageByKeywords(keyword) {
  const x = await axios.get('https://www.npmjs.com/search', {
    responseType: 'json',
    params: {
      q: `keywords:${keyword} not:deprecated,insecure quality-weight:5 popularity-weight:5`,
    },
  });

  return x.data.results;
}

const PARENT_FOLDER = path.resolve(__dirname, '../..');

async function main() {
  // latested packages from NPM
  const x = await axios.get(`https://www.npmjs.com`, {
    responseType: 'text',
  });

  const dom = new JSDOM(x.data);

  const links = Array.from(dom.window.document.querySelectorAll('a'));

  const packages = links
    .filter((a) => a.pathname.startsWith('/package/'))
    .map((a) => a.pathname.replace('/package/', ''));

  shuffle(packages);
  console.log('Found packages', packages);

  for (const packageName of packages) {
    const keywords = await getKeywordsInfo(packageName);
    if (!keywords || keywords.length === 0) {
      continue;
    }

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
          `git clone ${url} "${path.join(__dirname, 'test-folder')}"`
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
        const repos = axios.get(`https://api.github.com/orgs/${OWNER_NAME}/repos`, {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
          },
          responseType: 'json',
        });

        for (const repo of repos) {
          if (repo.full_name === CURRENT_REPO) {
            console.log('Skip repo %s due to current repo', repo.full_name);
            continue;
          }

          try {
            const packageJSON = axios.get(
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
