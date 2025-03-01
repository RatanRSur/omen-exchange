import { BigNumber, parseUnits } from 'ethers/utils'
import moment from 'moment'
import momentTZ from 'moment-timezone'
import React, { DOMAttributes, useEffect, useState } from 'react'
import styled from 'styled-components'

import { useConnectedWeb3Context, useSymbol, useTokens } from '../../../../hooks'
import { CompoundService } from '../../../../services'
import { getNativeAsset, getToken } from '../../../../util/networks'
import { formatBigNumber, formatDate, formatToShortNumber, getBaseTokenForCToken } from '../../../../util/tools'
import { CompoundTokenType, Token } from '../../../../util/types'
import { TextToggle } from '../TextToggle'

const MarketDataWrapper = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: 24px;

  & > * + * {
    margin-left: 38px;
  }

  @media (max-width: ${props => props.theme.themeBreakPoints.md}) {
    flex-direction: column;
    margin-bottom: 20px;
    & > * + * {
      margin-top: 13px;
      margin-left: 0;
    }
  }
`

const MarketDataItem = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  height: 39px;

  @media (max-width: ${props => props.theme.themeBreakPoints.md}) {
    width: 100%;
    flex-direction: row-reverse;
    height: 16px;
  }
`

const MarketDataItemTop = styled.div`
  color: ${props => props.theme.colors.textColorDarker}
  font-size: 14px;
  font-weight: 500;
  line-height: 16px;
`

const MarketDataItemBottom = styled.div`
  color: ${props => props.theme.colors.textColor}
  font-size: 14px;
  font-weight: 400;
  line-height: 16px;
`

const MarketDataItemImage = styled.img`
  max-height: 18px;
  max-width: 18px;
  margin-right: 10px;
`

interface Props extends DOMAttributes<HTMLDivElement> {
  collateralVolume: BigNumber
  compoundService: CompoundService | null
  liquidity: string
  resolutionTimestamp: Date
  runningDailyVolumeByHour: BigNumber[]
  lastActiveDay: number
  currency: Token
  isFinalize?: boolean
  answerFinalizedTimestamp?: Maybe<BigNumber>
}

export const MarketData: React.FC<Props> = props => {
  const {
    answerFinalizedTimestamp,
    collateralVolume,
    compoundService,
    currency,
    isFinalize = false,
    lastActiveDay,
    liquidity,
    resolutionTimestamp,
    runningDailyVolumeByHour,
  } = props

  const context = useConnectedWeb3Context()
  const { networkId, relay } = context
  const { tokens } = useTokens(context)
  const [currencyIcon, setCurrencyIcon] = useState<string | undefined>('')
  const [showUTC, setShowUTC] = useState<boolean>(true)
  const [show24H, setShow24H] = useState<boolean>(false)

  useEffect(() => {
    const matchingAddress = (token: Token) => token.address.toLowerCase() === currency.address.toLowerCase()
    const tokenIndex = tokens.findIndex(matchingAddress)
    tokenIndex !== -1 && setCurrencyIcon(tokens[tokenIndex].image)
  }, [tokens, currency.address])

  const timezoneAbbr = momentTZ.tz(momentTZ.tz.guess()).zoneAbbr()

  const dailyVolumeValue =
    Math.floor(Date.now() / 86400000) === lastActiveDay && runningDailyVolumeByHour && currency.decimals
      ? runningDailyVolumeByHour[Math.floor(Date.now() / (1000 * 60 * 60)) % 24]
      : new BigNumber('0')

  const dailyVolume = formatBigNumber(dailyVolumeValue, currency.decimals)

  const totalVolume = formatBigNumber(collateralVolume, currency.decimals)

  let displayDailyVolume = dailyVolume
  let displayTotalVolume = totalVolume
  let displayLiquidity = liquidity
  let baseCurrency = currency
  const currencySymbol = currency.symbol.toLowerCase()
  if (compoundService && currencySymbol in CompoundTokenType) {
    if (currencySymbol === 'ceth') {
      baseCurrency = getNativeAsset(networkId, relay)
    } else {
      const baseCurrencySymbol = getBaseTokenForCToken(currency.symbol) as KnownToken
      baseCurrency = getToken(context.networkId, baseCurrencySymbol)
    }
    const displayTotalVolumeValue = compoundService.calculateCTokenToBaseExchange(baseCurrency, collateralVolume)
    displayTotalVolume = formatBigNumber(displayTotalVolumeValue, baseCurrency.decimals)

    const liquidityRaw = parseUnits(liquidity, currency.decimals)
    const baseTokenLiquidityRaw = compoundService.calculateCTokenToBaseExchange(baseCurrency, liquidityRaw)
    displayLiquidity = formatBigNumber(baseTokenLiquidityRaw, baseCurrency.decimals)

    const baseDailyVolumeValue = compoundService.calculateCTokenToBaseExchange(baseCurrency, dailyVolumeValue)
    displayDailyVolume = formatBigNumber(baseDailyVolumeValue, baseCurrency.decimals)
  }
  const symbol = useSymbol(baseCurrency)
  return (
    <MarketDataWrapper>
      <MarketDataItem>
        <MarketDataItemTop>
          {formatToShortNumber(displayLiquidity)} {symbol}
        </MarketDataItemTop>
        <MarketDataItemBottom>Liquidity</MarketDataItemBottom>
      </MarketDataItem>
      <MarketDataItem>
        <MarketDataItemTop>
          <MarketDataItemImage src={currencyIcon && currencyIcon}></MarketDataItemImage>
          {show24H ? formatToShortNumber(displayDailyVolume) : formatToShortNumber(displayTotalVolume)}
          &nbsp;{symbol}
        </MarketDataItemTop>
        <TextToggle
          alternativeLabel="24h Volume"
          isMain={!show24H}
          mainLabel="Total Volume"
          onClick={() => setShow24H(value => !value)}
        />
      </MarketDataItem>
      <MarketDataItem>
        <MarketDataItemTop>
          {showUTC
            ? formatDate(resolutionTimestamp, false)
            : moment(resolutionTimestamp).format('YYYY-MM-DD - H:mm zz')}{' '}
        </MarketDataItemTop>
        <TextToggle
          alternativeLabel={`Closing Date - ${timezoneAbbr}`}
          isMain={showUTC}
          mainLabel="Closing Date - UTC"
          onClick={() => setShowUTC(value => !value)}
        />
      </MarketDataItem>
      {isFinalize && answerFinalizedTimestamp && (
        <MarketDataItem>
          <MarketDataItemTop>In {moment(answerFinalizedTimestamp.toNumber() * 1000).fromNow(true)}</MarketDataItemTop>
          <MarketDataItemBottom>Finalized</MarketDataItemBottom>
        </MarketDataItem>
      )}
      {!isFinalize && resolutionTimestamp > new Date() && (
        <MarketDataItem>
          <MarketDataItemTop>{moment(resolutionTimestamp).fromNow(true)}</MarketDataItemTop>
          <MarketDataItemBottom>Remaining</MarketDataItemBottom>
        </MarketDataItem>
      )}
    </MarketDataWrapper>
  )
}
