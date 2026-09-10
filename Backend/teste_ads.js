const AdsClient = require('ads-client').Client;

const client = new AdsClient({
    targetAmsNetId: '39.90.64.65.1.1',
    targetAdsPort: 851,
    localAmsNetId: '192.168.56.1.1.1'
});

async function main() {

    await client.connect();

    console.log('✅ PLC Conectado');

    setInterval(async () => {

        try {

            const producao =
                await client.readValue(
                    'GVL_LinhaEnvase.GarrafasProduzidas'
                );

            const motor =
                await client.readValue(
                    'GVL_LinhaEnvase.MotorEsteira'
                );

            const ev =
                await client.readValue(
                    'GVL_LinhaEnvase.EV_Operando'
                );

            const st =
                await client.readValue(
                    'GVL_LinhaEnvase.ST_Operando'
                );

            console.clear();

            console.log(
                'Produção:',
                producao.value
            );

            console.log(
                'Motor:',
                motor.value
            );

            console.log(
                'EV:',
                ev.value
            );

            console.log(
                'ST:',
                st.value
            );

        }

        catch(err){

            console.error(err);

        }

    },1000);

}

main();