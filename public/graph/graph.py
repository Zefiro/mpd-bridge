#!/usr/bin/env python3

# numpy on raspi is 0.16.2, pandas requires 0.16.5 starting pandas 1.1.0 -> I guess pandas 1.0.5 might work
# pip3 install --upgrade pandas==1.0.5

# libraries
import matplotlib.pyplot as plt, mpld3
from influxdb import InfluxDBClient
from influxdb import DataFrameClient
import pandas as pd

INFLUXDB_ADDRESS = '10.20.30.5'
INFLUXDB_PORT = 8086
INFLUXDB_USER = 'grafana'
INFLUXDB_PASSWORD = 'grag-grafana'
INFLUXDB_DATABASE = 'tasmota_tele'

influxdb_client = InfluxDBClient(INFLUXDB_ADDRESS, INFLUXDB_PORT, INFLUXDB_USER, INFLUXDB_PASSWORD, None)
influxdb_client.switch_database(INFLUXDB_DATABASE)

cli = DataFrameClient(INFLUXDB_ADDRESS, INFLUXDB_PORT, INFLUXDB_USER, INFLUXDB_PASSWORD, None)
cli.switch_database(INFLUXDB_DATABASE)

print(influxdb_client.get_list_database())

#result = influxdb_client.query('SELECT "Temperature" FROM "SENSOR" WHERE ("location" = \'grag-sensor1\' AND "sensor" = \'BME280-76\') AND time >= now() - 24h GROUP BY "location", "sensor"')
#print(result)

print("Fetching data")
#res = cli.query('SELECT "Temperature" FROM "SENSOR" WHERE ("location" = \'grag-sensor1\' AND "sensor" = \'BME280-76\') AND time >= now() - 24h GROUP BY "location", "sensor"')

res = cli.query('SELECT "Temperature" FROM "SENSOR" WHERE ("location" = \'grag-sensor1\') AND time >= now() - 7d GROUP BY "sensor"')

print("Processing data")
i = 0
last = None
for a in res:
	print("Processing for", a)
	print(res[a])
	i=i+1
	if last is None:
		last = res[a].plot()
	else:
		last = res[a].plot(ax=last)




#print(res)
#res1 = res['(\'SENSOR\', ((\'sensor\', \'BME280-76\'),))']
#print(res1)
#res1.plot()

print("Writing PNG")
plt.savefig('data.png')									  

print("Writing HTML")
html_str = mpld3.fig_to_html(plt.gcf())
Html_file= open("index.html","w")
Html_file.write(html_str)
Html_file.close()
