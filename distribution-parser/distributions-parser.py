import ast
import os

file = 'distributions_backward_queue.txt'
out_file = 'distributions.txt'

# lane, timestep, position

with open(file) as file:
    # this takes a while
    data = ast.literal_eval(file.read())

n_lanes = len(data)
n_timesteps = len(data[0])
n_positions = len(data[0][0])

if os.path.exists(out_file):
    os.remove(out_file)
with open(out_file, 'w') as file:
    #file.write('[\n')
    for step in range(n_timesteps):
        #file.write('[\n')
        for lane in range(n_lanes):
            file.write(str(data[lane][step]))
            if lane < n_lanes - 1:
                #file.write(',\n')
                file.write('\n')
            else:
                file.write('\n')
        file.write('-\n')
        #if step < n_timesteps - 1:
        #    file.write('],\n')
        #else:
        #    file.write(']\n')
    #file.write(']\n')

