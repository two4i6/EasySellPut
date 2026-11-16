import useSWR, { SWRConfiguration, SWRResponse, Key } from 'swr';
import { useToastStore } from '../store/useToastStore';
import { useEffect } from 'react';

interface AppSWRConfig<Data = any, Error = any> extends SWRConfiguration<Data, Error> {
  showErrorToast?: boolean;
  showSuccessToast?: boolean;
  errorMessage?: string;
  successMessage?: string;
}

export function useAppSWR<Data = any, Error = any>(
  key: Key,
  fetcher: ((...args: any[]) => Data | Promise<Data>) | null,
  config?: AppSWRConfig<Data, Error>
): SWRResponse<Data, Error> {
  const addToast = useToastStore(state => state.addToast);
  const {
    showErrorToast = true,
    showSuccessToast = false,
    errorMessage = '请求失败',
    successMessage = '请求成功',
    ...swrConfig
  } = config || {};

  const response = useSWR<Data, Error>(key, fetcher, swrConfig);

  const { data, error } = response;

  useEffect(() => {
    if (error && showErrorToast) {
      addToast({
        type: 'error',
        title: '请求出错',
        message: `${errorMessage}: ${error instanceof Error ? error.message : '未知错误'}`,
      });
    }
  }, [error, showErrorToast, errorMessage, addToast]);

  useEffect(() => {
    if (data && showSuccessToast) {
      addToast({
        type: 'success',
        title: '成功',
        message: successMessage,
      });
    }
  }, [data, showSuccessToast, successMessage, addToast]);

  return response;
}

export default useAppSWR;
