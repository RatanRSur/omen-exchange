import { Zero } from 'ethers/constants'
import { BigNumber, parseUnits } from 'ethers/utils'
import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

import {
  useAsyncDerivedValue,
  useCompoundService,
  useConnectedWeb3Context,
  useContracts,
  useSymbol,
} from '../../../../hooks'
import { CPKService, MarketMakerService } from '../../../../services'
import { getLogger } from '../../../../util/logger'
import { getNativeAsset, getWrapToken } from '../../../../util/networks'
import {
  calcPrediction,
  calcSellAmountInCollateral,
  calcXValue,
  computeBalanceAfterTrade,
  formatBigNumber,
  formatNumber,
  getInitialCollateral,
  getSharesInBaseToken,
  getUnit,
  mulBN,
} from '../../../../util/tools'
import {
  BalanceItem,
  CompoundTokenType,
  MarketDetailsTab,
  MarketMakerData,
  Status,
  Token,
} from '../../../../util/types'
import { Button, ButtonContainer, ButtonTab } from '../../../button'
import { ButtonType } from '../../../button/button_styling_types'
import { BigNumberInput, TextfieldCustomPlaceholder } from '../../../common'
import { BigNumberInputReturn } from '../../../common/form/big_number_input'
import { FullLoading } from '../../../loading'
import { ModalTransactionResult } from '../../../modal/modal_transaction_result'
import { GenericError } from '../../common/common_styled'
import { GridTransactionDetails } from '../../common/grid_transaction_details'
import { MarketScale } from '../../common/market_scale'
import { PositionSelectionBox } from '../../common/position_selection_box'
import { SwitchTransactionToken } from '../../common/switch_transaction_token'
import { TokenBalance } from '../../common/token_balance'
import { TransactionDetailsCard } from '../../common/transaction_details_card'
import { TransactionDetailsLine } from '../../common/transaction_details_line'
import { TransactionDetailsRow, ValueStates } from '../../common/transaction_details_row'
import { WarningMessage } from '../../common/warning_message'

const StyledButtonContainer = styled(ButtonContainer)`
  justify-content: space-between;
  margin-right: -24px;
  margin-left: -24px;
  padding-right: 24px;
  padding-left: 24px;
  border-top: 1px solid ${props => props.theme.colors.verticalDivider};
`

const logger = getLogger('Scalar Market::Sell')

interface Props {
  currentTab: MarketDetailsTab
  fetchGraphMarketMakerData: () => Promise<void>
  fetchGraphMarketUserTxData: () => Promise<void>
  marketMakerData: MarketMakerData
  switchMarketTab: (arg0: MarketDetailsTab) => void
}

export const ScalarMarketSell = (props: Props) => {
  const { currentTab, fetchGraphMarketMakerData, fetchGraphMarketUserTxData, marketMakerData, switchMarketTab } = props
  const context = useConnectedWeb3Context()
  const { library: provider } = context

  const {
    address: marketMakerAddress,
    balances,
    collateral,
    fee,
    outcomeTokenMarginalPrices,
    question,
    scalarHigh,
    scalarLow,
  } = marketMakerData
  const { buildMarketMaker, conditionalTokens } = useContracts(context)
  const marketMaker = useMemo(() => buildMarketMaker(marketMakerAddress), [buildMarketMaker, marketMakerAddress])

  const [positionIndex, setPositionIndex] = useState(balances[0].shares.gte(balances[1].shares) ? 0 : 1)
  const [balanceItem, setBalanceItem] = useState<BalanceItem>(balances[positionIndex])
  const [status, setStatus] = useState<Status>(Status.Ready)
  const [message, setMessage] = useState<string>('')
  const [isModalTransactionResultOpen, setIsModalTransactionResultOpen] = useState(false)
  const [amountShares, setAmountShares] = useState<Maybe<BigNumber>>(new BigNumber(0))
  const [amountSharesToDisplay, setAmountSharesToDisplay] = useState<string>('')
  const [displaySellShares, setDisplaySellShares] = useState<Maybe<BigNumber>>(new BigNumber(0))
  const [isNegativeAmountShares, setIsNegativeAmountShares] = useState<boolean>(false)
  const { networkId } = context
  const baseCollateral = getInitialCollateral(networkId, collateral)
  const [displayCollateral, setDisplayCollateral] = useState<Token>(baseCollateral)
  const collateralSymbol = collateral.symbol.toLowerCase()
  const symbol = useSymbol(displayCollateral)

  const { compoundService: CompoundService } = useCompoundService(collateral, context)
  const compoundService = CompoundService || null

  const wrapToken = getWrapToken(context.networkId)
  let displayTotalSymbol = symbol
  if (collateral.address === displayCollateral.address && collateral.address === wrapToken.address) {
    displayTotalSymbol = displayCollateral.symbol
  }

  let displayBalances = balances
  if (
    baseCollateral.address !== collateral.address &&
    collateral.symbol.toLowerCase() in CompoundTokenType &&
    compoundService
  ) {
    displayBalances = getSharesInBaseToken(balances, compoundService, displayCollateral)
  }

  useEffect(() => {
    setIsNegativeAmountShares(formatBigNumber(amountShares || Zero, collateral.decimals).includes('-'))
  }, [amountShares, collateral.decimals])

  useEffect(() => {
    setBalanceItem(balances[positionIndex])
    // eslint-disable-next-line
  }, [balances[positionIndex]])

  useEffect(() => {
    setPositionIndex(balances[0].shares.gte(balances[1].shares) ? 0 : 1)
    setBalanceItem(balances[positionIndex])
    setAmountShares(null)
    setAmountSharesToDisplay('')
    // eslint-disable-next-line
  }, [collateral.address])

  const calcSellAmount = useMemo(
    () => async (
      amountShares: BigNumber,
    ): Promise<[Maybe<BigNumber>, Maybe<number>, Maybe<BigNumber>, Maybe<BigNumber>]> => {
      const holdings = balances.map(balance => balance.holdings)
      const holdingsOfSoldOutcome = holdings[positionIndex]
      const holdingsOfOtherOutcome = holdings.filter((item, index) => {
        return index !== positionIndex
      })
      const marketFeeWithTwoDecimals = Number(formatBigNumber(fee, 18))

      const amountToSell = calcSellAmountInCollateral(
        // If the transaction incur in some precision error, we need to multiply the amount by some factor, for example  amountShares.mul(99999).div(100000) , bigger the factor, less dust
        amountShares,
        holdingsOfSoldOutcome,
        holdingsOfOtherOutcome,
        marketFeeWithTwoDecimals,
      )

      if (!amountToSell) {
        logger.warn(
          `Could not compute amount of collateral to sell for '${amountShares.toString()}' and '${holdingsOfSoldOutcome.toString()}'`,
        )
        return [null, null, null, null]
      }

      const balanceAfterTrade = computeBalanceAfterTrade(
        balances.map(b => b.holdings),
        positionIndex,
        amountToSell.mul(-1),
        amountShares.mul(-1),
      )

      const pricesAfterTrade = MarketMakerService.getActualPrice(balanceAfterTrade)
      const potentialValue = mulBN(amountToSell, 1 / (1 - marketFeeWithTwoDecimals))
      const costFee = potentialValue.sub(amountToSell)

      const newPrediction = calcPrediction(
        pricesAfterTrade[1].toString(),
        scalarLow || new BigNumber(0),
        scalarHigh || new BigNumber(0),
      )

      logger.log(`Amount to sell ${amountToSell}`)
      return [costFee, newPrediction, amountToSell, potentialValue]
    },
    [balances, positionIndex, scalarLow, scalarHigh, fee],
  )

  const [costFee, newPrediction, tradedCollateral, potentialValue] = useAsyncDerivedValue(
    amountShares || Zero,
    [new BigNumber(0), 0, amountShares, new BigNumber(0)],
    calcSellAmount,
  )

  const formattedNewPrediction =
    newPrediction &&
    calcXValue(
      parseUnits(newPrediction.toString(), 18),
      scalarLow || new BigNumber(0),
      scalarHigh || new BigNumber(0),
    ) / 100

  let potentialValueNormalized = potentialValue
  let costFeeNormalized = costFee
  let normalizedTradedCollateral = tradedCollateral
  if (displayCollateral.address !== collateral.address && compoundService) {
    if (potentialValue && potentialValue.gt(0)) {
      potentialValueNormalized = compoundService.calculateCTokenToBaseExchange(displayCollateral, potentialValue)
    } else {
      potentialValueNormalized = new BigNumber('0')
    }
    if (costFee && costFee.gt(0)) {
      costFeeNormalized = compoundService.calculateCTokenToBaseExchange(displayCollateral, costFee)
    } else {
      costFeeNormalized = new BigNumber('0')
    }
    if (tradedCollateral && tradedCollateral.gt(0)) {
      normalizedTradedCollateral = compoundService.calculateCTokenToBaseExchange(displayCollateral, tradedCollateral)
    } else {
      normalizedTradedCollateral = new BigNumber('0')
    }
  }

  const finish = async () => {
    const outcomeIndex = positionIndex
    try {
      if (!tradedCollateral) {
        return
      }

      const sharesAmount = formatBigNumber(amountShares || Zero, collateral.decimals)

      let displaySharesAmount = sharesAmount
      if (collateral.symbol.toLowerCase() in CompoundTokenType && amountShares && compoundService) {
        const displaySharesAmountValue = compoundService.calculateCTokenToBaseExchange(baseCollateral, amountShares)
        displaySharesAmount = formatBigNumber(displaySharesAmountValue || Zero, baseCollateral.decimals)
      }
      setStatus(Status.Loading)
      setMessage(`Selling ${displaySharesAmount} shares...`)

      const cpk = await CPKService.create(provider)

      await cpk.sellOutcomes({
        amount: tradedCollateral,
        conditionalTokens,
        marketMaker,
        outcomeIndex,
      })

      await fetchGraphMarketUserTxData()
      await fetchGraphMarketMakerData()

      setAmountShares(null)
      setAmountSharesToDisplay('')
      setStatus(Status.Ready)
      setMessage(`Successfully sold ${sharesAmount} '${balances[outcomeIndex].outcomeName}' shares.`)
    } catch (err) {
      setStatus(Status.Error)
      setMessage(`Error trying to sell '${balances[outcomeIndex].outcomeName}' Shares.`)
      logger.error(`${message} - ${err.message}`)
    }
    setIsModalTransactionResultOpen(true)
  }

  const selectedOutcomeBalance = formatNumber(formatBigNumber(balanceItem.shares, collateral.decimals))

  let displaySelectedOutcomeBalance = selectedOutcomeBalance
  let displaySelectedOutcomeBalanceValue = balanceItem.shares
  if (collateralSymbol in CompoundTokenType && compoundService) {
    displaySelectedOutcomeBalanceValue = compoundService.calculateCTokenToBaseExchange(
      baseCollateral,
      balanceItem.shares,
    )
    displaySelectedOutcomeBalance = formatNumber(
      formatBigNumber(displaySelectedOutcomeBalanceValue, baseCollateral.decimals),
    )
  }

  const amountError =
    balanceItem.shares === null
      ? null
      : balanceItem.shares.isZero() && amountShares?.gt(balanceItem.shares)
      ? `Insufficient balance`
      : amountShares?.gt(balanceItem.shares)
      ? `Value must be less than or equal to ${displaySelectedOutcomeBalance} shares`
      : null

  const isSellButtonDisabled =
    !amountShares ||
    (status !== Status.Ready && status !== Status.Error) ||
    amountShares?.isZero() ||
    amountError !== null ||
    isNegativeAmountShares

  let toggleCollateral = collateral
  if (collateralSymbol in CompoundTokenType) {
    if (collateral.address === displayCollateral.address) {
      toggleCollateral = baseCollateral
    } else {
      toggleCollateral = collateral
    }
  } else {
    if (collateral.address === wrapToken.address) {
      if (displayCollateral.address === wrapToken.address) {
        toggleCollateral = getNativeAsset(context.networkId)
      } else {
        toggleCollateral = getWrapToken(context.networkId)
      }
    }
  }
  const setToggleCollateral = () => {
    if (collateralSymbol in CompoundTokenType) {
      if (displayCollateral.address === baseCollateral.address) {
        setDisplayCollateral(collateral)
      } else {
        setDisplayCollateral(baseCollateral)
      }
    } else {
      if (displayCollateral.address === wrapToken.address) {
        setDisplayCollateral(getNativeAsset(context.networkId))
      } else {
        setDisplayCollateral(getWrapToken(context.networkId))
      }
    }
  }

  const isNewPrediction =
    formattedNewPrediction !== 0 && formattedNewPrediction !== Number(outcomeTokenMarginalPrices[1].substring(0, 20))

  const setAmountSharesFromInput = (shares: BigNumber) => {
    if (collateralSymbol in CompoundTokenType && compoundService) {
      const actualAmountOfShares = compoundService.calculateBaseToCTokenExchange(baseCollateral, shares)
      setAmountShares(actualAmountOfShares)
    } else {
      setAmountShares(shares)
    }
    setDisplaySellShares(shares)
  }

  return (
    <>
      <MarketScale
        borderTop={true}
        collateral={collateral}
        currentPrediction={isNewPrediction ? String(formattedNewPrediction) : outcomeTokenMarginalPrices[1]}
        currentTab={currentTab}
        long={positionIndex === 1}
        lowerBound={scalarLow || new BigNumber(0)}
        newPrediction={formattedNewPrediction}
        startingPointTitle={isNewPrediction ? 'New prediction' : 'Current prediction'}
        tradeAmount={potentialValue}
        unit={getUnit(question.title)}
        upperBound={scalarHigh || new BigNumber(0)}
      />
      <GridTransactionDetails>
        <div>
          <PositionSelectionBox
            balances={displayBalances}
            decimals={baseCollateral.decimals}
            positionIndex={positionIndex}
            setBalanceItem={setBalanceItem}
            setPositionIndex={setPositionIndex}
          />
          <TextfieldCustomPlaceholder
            formField={
              <BigNumberInput
                decimals={collateral.decimals}
                name="amount"
                onChange={(e: BigNumberInputReturn) => {
                  setAmountShares(e.value)
                  setAmountSharesFromInput(e.value.gt(Zero) ? e.value : Zero)
                  setAmountSharesToDisplay('')
                }}
                style={{ width: 0 }}
                value={amountShares}
                valueToDisplay={amountSharesToDisplay}
              />
            }
            onClickMaxButton={() => {
              setAmountSharesFromInput(displaySelectedOutcomeBalanceValue)
              setAmountSharesToDisplay(formatBigNumber(displaySelectedOutcomeBalanceValue, baseCollateral.decimals, 5))
            }}
            shouldDisplayMaxButton
            symbol={'Shares'}
          />
          {amountError && <GenericError>{amountError}</GenericError>}
        </div>
        <div>
          <TransactionDetailsCard>
            <TransactionDetailsRow
              title={'Sell Amount'}
              value={`${formatNumber(formatBigNumber(amountShares || Zero, collateral.decimals))} Shares`}
            />
            <TransactionDetailsRow
              emphasizeValue={potentialValue ? potentialValue.gt(0) : false}
              state={ValueStates.success}
              title={'Revenue'}
              value={
                potentialValueNormalized
                  ? `${formatNumber(formatBigNumber(potentialValueNormalized, displayCollateral.decimals, 2))} 
                  ${symbol}`
                  : '0.00'
              }
            />
            <TransactionDetailsRow
              title={'Fee'}
              value={`${
                costFeeNormalized
                  ? formatNumber(formatBigNumber(costFeeNormalized.mul(-1), displayCollateral.decimals, 2))
                  : '0.00'
              } ${symbol}`}
            />
            <TransactionDetailsLine />
            <TransactionDetailsRow
              emphasizeValue={
                (tradedCollateral && parseFloat(formatBigNumber(tradedCollateral, collateral.decimals, 2)) > 0) || false
              }
              state={
                (tradedCollateral &&
                  parseFloat(formatBigNumber(tradedCollateral, collateral.decimals, 2)) > 0 &&
                  ValueStates.important) ||
                ValueStates.normal
              }
              title={'Total'}
              value={`${
                normalizedTradedCollateral
                  ? formatNumber(formatBigNumber(normalizedTradedCollateral, displayCollateral.decimals, 2))
                  : '0.00'
              } ${displayTotalSymbol}`}
            />
            {collateral.address === wrapToken.address || collateralSymbol in CompoundTokenType ? (
              <SwitchTransactionToken onToggleCollateral={setToggleCollateral} toggleCollatral={toggleCollateral} />
            ) : (
              <span />
            )}
          </TransactionDetailsCard>
        </div>
      </GridTransactionDetails>
      {isNegativeAmountShares && (
        <WarningMessage
          additionalDescription={''}
          danger={true}
          description={`Your sell amount should not be negative.`}
          href={''}
          hyperlinkDescription={''}
        />
      )}
      <StyledButtonContainer>
        <Button buttonType={ButtonType.secondaryLine} onClick={() => switchMarketTab(MarketDetailsTab.swap)}>
          Cancel
        </Button>
        <Button buttonType={ButtonType.primaryAlternative} disabled={isSellButtonDisabled} onClick={finish}>
          Sell Position
        </Button>
      </StyledButtonContainer>
      <ModalTransactionResult
        isOpen={isModalTransactionResultOpen}
        onClose={() => setIsModalTransactionResultOpen(false)}
        status={status}
        text={message}
        title={status === Status.Error ? 'Transaction Error' : 'Sell Shares'}
      />
      {status === Status.Loading && <FullLoading message={message} />}
    </>
  )
}
