import ast, os

file = 'lane_indexes.txt'
out_file = 'lane_indexes_inverted.txt'

with open(file) as f:
    index_to_id = ast.literal_eval(f.readline())
    
    id_to_index = { index: ix for ix, index in index_to_id.items() }
    print(id_to_index)
