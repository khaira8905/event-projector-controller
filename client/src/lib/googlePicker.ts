/**
 * Google's own file picker (Google Picker API). People choose the files to import in Google's
 * window, so EventControl only ever gets access to those files (the "drive.file" scope) and
 * never sees the rest of their Drive.
 */

declare global {
  interface Window {
    gapi?: { load: (lib: string, opts: { callback: () => void; onerror: () => void }) => void };
    google?: { picker?: any };
  }
}

/** Presentations and PDFs, like "From this computer". */
const MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'application/vnd.google-apps.presentation',
];

export interface PickerSession {
  accessToken: string;
  appId: string;
  apiKey: string | null;
}

let loading: Promise<void> | null = null;

/** Loads Google's picker script once, on first use. */
export function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const fail = () => {
      loading = null;
      reject(new Error('Couldn’t load Google’s file picker. Check the internet connection and try again.'));
    };
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => (window.gapi ? window.gapi.load('picker', { callback: () => resolve(), onerror: fail }) : fail());
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

/** Opens the picker; resolves with the chosen file ids, or null when the person cancels. */
export function pickDriveFiles(session: PickerSession, maxItems = 20): Promise<string[] | null> {
  const gp = window.google!.picker;
  return new Promise((resolve) => {
    const view = new gp.DocsView(gp.ViewId.DOCS).setMimeTypes(MIME_TYPES.join(',')).setIncludeFolders(true).setSelectFolderEnabled(false);
    const builder = new gp.PickerBuilder()
      .addView(view)
      .enableFeature(gp.Feature.MULTISELECT_ENABLED)
      .enableFeature(gp.Feature.SUPPORT_DRIVES)
      .setMaxItems(maxItems)
      .setOAuthToken(session.accessToken)
      .setAppId(session.appId)
      .setTitle('Choose presentations to import')
      .setCallback((data: Record<string, any>) => {
        const action = data[gp.Response.ACTION];
        if (action === gp.Action.PICKED) resolve((data[gp.Response.DOCUMENTS] ?? []).map((d: Record<string, string>) => d[gp.Document.ID]));
        else if (action === gp.Action.CANCEL) resolve(null);
      });
    if (session.apiKey) builder.setDeveloperKey(session.apiKey);
    builder.build().setVisible(true);
  });
}
