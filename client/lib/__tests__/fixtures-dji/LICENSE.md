# DJI-Flugprotokolle (Testdaten)

Unveränderte Original-Bytes (SHA-256 unten), nur umbenannt. Keine API-Schlüssel,
keine Keychains enthalten.

| Datei | Herkunft | Lizenz |
| --- | --- | --- |
| `DJIFlightRecord_2018-06-19_v11_mavic-air.txt` | VTO Inc. / NIST CFReDS DF020, `2018_June/mobile_android_logical` (Original `DJIFlightRecord_2018-06-19_[14-50-34].txt`), weitergegeben im iLEAPP-Testkorpus (`admin/test/cases`) | MIT, Copyright (c) 2017 VTO Inc. |
| `DJIFlightRecord_2017-10-10_v9_short.txt` | wie oben (Original `DJIFlightRecord_2017-10-10_[10-02-22].txt`), von iLEAPP auf die ersten 170 Datensätze gekürzt (Details-Block erhalten) | MIT, Copyright (c) 2017 VTO Inc. |
| `DJIFlightRecord_2024-09-01_v14_encrypted.txt` | Beispiel aus pydjirecord (`examples/DJIFlightRecord_2024-09-01_[14-55-49].txt`, Commit `cabbce1b`), verschlüsselte Version 14 | MIT, Copyright (c) 2025 pydjirecord contributors |

SHA-256:

- `0a9f1816d52a98f840f6e67c08a14473ae5a0a2e75e9484d5de66368c4fd4c4a` v11_mavic-air
- `e5e9d6c0b5b10631696eeba60e4ab95aa09446db3f4a429a91e1d886f53e67b5` v9_short
- `2bf2ae5887286f42cfd6aacb3eefef05f4741b817f47d9fd9969fa25f6c7b354` v14_encrypted

## MIT-Lizenztexte

VTO-Datensatz (DF020):

```
MIT License
Copyright (c) 2017 VTO Inc.
VTO Inc. - Broomfield, Colorado - www.vtoinc.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this dataset and associated documentation files (the "Dataset"), to deal
in the Dataset without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Dataset, and to permit persons to whom the Dataset is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Dataset.

THE DATASET IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE DATASET OR THE USE OR OTHER DEALINGS IN THE
DATASET.
```

pydjirecord-Beispiel:

```
MIT License

Copyright (c) 2025 pydjirecord contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
