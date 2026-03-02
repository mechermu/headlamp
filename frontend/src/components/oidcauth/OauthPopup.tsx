/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Button from '@mui/material/Button';
import React, { ReactNode } from 'react';

interface OauthPopupProps {
  width?: number;
  height?: number;
  url: string;
  title?: string;
  onClose?: () => any;
  onCode: (params: any) => any;
  children?: ReactNode;
  button: typeof Button;
}

const defaultOauthPopupProps = {
  onClose: () => {},
  width: 500,
  height: 500,
  url: '',
  title: '',
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const OauthPopup: React.FC<OauthPopupProps> = props => {
  let externalWindow: Window | null;
  const pollIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(
    () => {
      return () => {
        if (externalWindow) {
          externalWindow.close();
        }
        if (pollIntervalRef.current !== null) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const createPopup = () => {
    const { url, title, width, height, onCode } = { ...defaultOauthPopupProps, ...props };
    const left = window.screenX + ((window.outerWidth - width) as number) / 2;
    const top = window.screenY + ((window.outerHeight - height) as number) / 2.5;

    const windowFeatures = `toolbar=0,scrollbars=1,status=1,resizable=0,location=1,menuBar=0,width=${width},height=${height},top=${top},left=${left}`;

    externalWindow = window.open(url, title, windowFeatures);

    if (window.desktopApi) {
      // Desktop (Electron) mode: poll the backend for the token.
      // The system browser handles the OIDC flow; Electron polls to retrieve the token
      // into its own session via Set-Cookie on the poll response.
      const clusterParam = new URL(url, window.location.href).searchParams.get('cluster') ?? '';
      const pollStart = Date.now();

      pollIntervalRef.current = setInterval(async () => {
        if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
          if (pollIntervalRef.current !== null) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return;
        }

        try {
          const resp = await fetch(`/oidc-token-poll?cluster=${encodeURIComponent(clusterParam)}`, {
            credentials: 'include',
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data.status === 'success') {
              if (pollIntervalRef.current !== null) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
              onCode('success');
            }
          }
        } catch (e) {
          console.log('error polling oidc-token-poll', e);
        }
      }, POLL_INTERVAL_MS);
    } else {
      // Web mode: listen for localStorage change set by the OIDC callback page.
      const storageListener = () => {
        try {
          const authStatus = localStorage.getItem('auth_status');
          if (authStatus) {
            onCode(authStatus);
            localStorage.removeItem('auth_status');
            if (externalWindow) {
              externalWindow.close();
            }
            window.removeEventListener('storage', storageListener);
          }
        } catch (e) {
          console.log('error occured while closing auth window', e);
          window.removeEventListener('storage', storageListener);
        }
      };

      window.addEventListener('storage', storageListener);
    }

    if (externalWindow) {
      try {
        externalWindow.addEventListener(
          'beforeunload',
          () => {
            if (!!props.onClose) {
              props.onClose();
            }
          },
          false
        );
      } catch (e) {
        console.log('error occured while adding beforeunload event listener');
      }
    }
  };

  return <props.button onClick={createPopup}>{props.children}</props.button>;
};

export default OauthPopup;
