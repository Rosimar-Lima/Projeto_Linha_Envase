const express = require('express');
const cors = require('cors');
const AdsClient = require('ads-client').Client;

const app = express();
app.use(cors());

const client = new AdsClient({

    targetAmsNetId: '39.90.64.65.1.1',

    targetAdsPort: 851,

    localAmsNetId: '192.168.56.1.1.1'

});

client.connect()
.then(() => {

    console.log('✅ PLC conectado');

})
.catch(err => {

    console.error(
        'Erro ao conectar PLC:',
        err
    );

});

app.get('/status', async (req, res) => {

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

        res.json({

            producao: producao.value,
            motor: motor.value,
            ev: ev.value,
            st: st.value

        });

    }

    catch(err){

        res.status(500).json({

            erro: err.message

        });

    }

});

app.listen(3000, () => {

    console.log(
        'Servidor rodando na porta 3000'
    );

});