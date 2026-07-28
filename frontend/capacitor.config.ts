import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'ru.cargocamp.app',
    appName: 'CargoCamp',
    webDir: 'build',

    server: {
        androidScheme: 'http',
        cleartext: true,
    },

    android: {
        allowMixedContent: true,
    },

    plugins: {
        CapacitorHttp: {
            enabled: false,
        },
        Keyboard: {

            resizeOnFullScreen: true,

        },
    },
};

export default config;