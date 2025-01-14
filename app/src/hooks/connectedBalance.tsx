import { Zero } from 'ethers/constants'
import { BigNumber } from 'ethers/utils'
import React, { useEffect, useState } from 'react'

import { STANDARD_DECIMALS } from '../common/constants'
import { useCollateralBalance, useConnectedWeb3Context, useTokens } from '../hooks'
import { XdaiService } from '../services'
import { getLogger } from '../util/logger'
import { getNativeAsset, networkIds } from '../util/networks'
import { formatBigNumber, formatNumber } from '../util/tools'

const logger = getLogger('Hooks::ConnectedBalance')

export interface ConnectedBalanceContext {
  claimState: boolean
  unclaimedAmount: BigNumber
  ethBalance: BigNumber
  formattedEthBalance: string
  daiBalance: BigNumber
  formattedDaiBalance: string
  xDaiBalance: BigNumber
  formattedxDaiBalance: string
  fetchBalances: () => Promise<void>
}

const ConnectedBalanceContext = React.createContext<Maybe<ConnectedBalanceContext>>(null)

/**
 * This hook can only be used by components under the `ConnectedWeb3` component. Otherwise it will throw.
 */
export const useConnectedBalanceContext = () => {
  const context = React.useContext(ConnectedBalanceContext)

  if (!context) {
    throw new Error('Component rendered outside the provider tree')
  }

  return context
}

interface Props {
  children?: React.ReactNode
}
/**
 * Component used to render components that depend on Web3 being available. These components can then
 * `useConnectedWeb3Context` safely to get web3 stuff without having to null check it.
 */
export const ConnectedBalance: React.FC<Props> = (props: Props) => {
  const context = useConnectedWeb3Context()
  const { relay } = context
  const { account, networkId } = context.rawWeb3Context
  const [claimState, setClaimState] = useState<boolean>(false)
  const [unclaimedAmount, setUnclaimedAmount] = useState<BigNumber>(Zero)

  const { refetch, tokens } = useTokens(context.rawWeb3Context, true, true)

  const ethBalance = new BigNumber(
    tokens.filter(token => token.symbol === getNativeAsset(context.rawWeb3Context.networkId).symbol)[0]?.balance || '',
  )
  const formattedEthBalance = formatNumber(formatBigNumber(ethBalance, STANDARD_DECIMALS, STANDARD_DECIMALS), 3)
  const daiBalance = new BigNumber(tokens.filter(token => token.symbol === 'DAI')[0]?.balance || '')
  const formattedDaiBalance = formatNumber(formatBigNumber(daiBalance, STANDARD_DECIMALS, STANDARD_DECIMALS))

  const nativeAsset = getNativeAsset(context.networkId)
  const { collateralBalance, fetchCollateralBalance } = useCollateralBalance(nativeAsset, context)
  const xDaiBalance = collateralBalance || Zero
  const formattedxDaiBalance = `${formatBigNumber(xDaiBalance, nativeAsset.decimals, 2)}`

  const fetchUnclaimedAssets = async () => {
    if (account && networkId === networkIds.MAINNET) {
      const xDaiService = new XdaiService(context.library)
      const transactions = await xDaiService.fetchXdaiTransactionData()

      if (transactions && transactions.length) {
        const aggregator = transactions.reduce((prev: BigNumber, { value }: any) => prev.add(value), Zero)
        setUnclaimedAmount(aggregator)
        setClaimState(true)
        return
      }
      setUnclaimedAmount(Zero)
      setClaimState(false)
    }
  }

  const fetchBalances = async () => {
    try {
      await Promise.all([fetchUnclaimedAssets(), fetchCollateralBalance(), refetch()])
    } catch (e) {
      logger.log(e.message)
    }
  }

  useEffect(() => {
    if (relay) {
      fetchBalances()
    } else {
      setUnclaimedAmount(Zero)
      setClaimState(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, networkId])

  const value = {
    claimState,
    unclaimedAmount,
    ethBalance,
    formattedEthBalance,
    daiBalance,
    formattedDaiBalance,
    xDaiBalance,
    formattedxDaiBalance,
    fetchBalances,
  }

  return <ConnectedBalanceContext.Provider value={value}>{props.children}</ConnectedBalanceContext.Provider>
}
