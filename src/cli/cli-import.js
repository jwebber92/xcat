import program from 'commander'

import Config from '../config'

import {fileToObj, verifyConfigFile} from './utils'

let tradeId, configJSON
program
  .description(
    `Import a trade with a given trade.json file. Typically this file is ` +
      `sent from a counterparty who initiated a trade with "trade new". ` +
      `As with "trade new" this trade.json must conform to the schema in ` +
      `schema/trade.json.`
  )
  .option(
    '-c, --config <path>',
    'Config file (see config.json.template). Defaults to ./config.json.'
  )
  .arguments('<tradeId>')
  .action(function(id, options) {
    tradeId = id
    configJSON = options.config
  })

program.parse(process.argv)

if (!verifyConfigFile(configJSON)) program.help()

const config = new Config(fileToObj(configJSON))
