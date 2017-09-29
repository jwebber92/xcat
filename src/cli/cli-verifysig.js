import chalk from 'chalk'
import {existsSync} from 'fs'

import Trade from '../trade'
import {commander as program, verifyArgTradeFile} from './utils'
import {fileToObj, fileToStr, verify} from '../utils'

let signatureFile, tradeJSON
program
  .description(
    'Verify a signature for the trade file was produced by the stellar depositor.\n'
  )
  .arguments('<trade.json> <trade.json.sig>')
  .action((jsonFile, sigFile) => {
    tradeJSON = jsonFile
    signatureFile = sigFile
  })
  .parse(process.argv)

if (!verifyArgTradeFile(tradeJSON)) program.help()
if (!existsSync(signatureFile)) program.help()

console.log(`Verifying signature ...\n`)
const trade = new Trade(fileToObj(tradeJSON))
const signer = trade.stellar.depositor
const signature = fileToStr(signatureFile)
const tradeFileStr = fileToStr(tradeJSON)

const isOk = verify(signer, signature, tradeFileStr)
console.log(
  isOk ? chalk.bgGreen.white.bold(`SUCCESS`) : chalk.bgRed.white.bold(`FAILED`)
)